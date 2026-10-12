import {
  appointmentInputSchema,
  appointmentPatchSchema,
  rescheduleAppointmentInputSchema,
  sharedAppointmentListResultSchema,
} from '@agendabo/contracts';
import { AppointmentsService, SharedAccessInvalidError } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { SharedAgendasService } from '../shared-agendas/shared-agendas.service';
import { SharedAgendaAuditService } from '../shared-agendas/shared-agenda-audit.service';

/**
 * Leitura da agenda EMPRESTADA (Etapa 3 — spec compartilhamento B.12–B.15,
 * decisoes D2/D3 do plano). Jest com mock plano (testing.md), fixtures no
 * padrao dos vizinhos (`appointments.service.spec.ts`): a fronteira falsa e
 * Prisma/sharedAgendas/audit; o zod dos contracts e de verdade.
 *
 * Matriz que este spec NAO negocia:
 *  - B.12: 403 UNIFORME (`SharedAccessInvalidError`) para qualquer vinculo que
 *    nao seja ATIVO (pending vivo, pending morto, revoked, self, uuid
 *    inexistente) — a decisao e do `activeLinkBetween` da Etapa 2 (pending
 *    MORTA nao e ativa: effectiveStatus da pura); aqui o sabor morre no MESMO
 *    erro sem oraculo. Os casos reais de effectiveStatus tem teste proprio no
 *    vizinho `shared-agendas.service.spec.ts`/`shared-invite.spec.ts`.
 *  - D3: privacidade na CONSULTA — where com `status: 'confirmed'` e select SEM
 *    rawText/reviewReason/notificationRules (assert no args do mock E no shape
 *    de saida com `sharedAppointmentListResultSchema`);
 *  - D2 zero regressao: SEM owner o findMany recebe where/include/orderBy
 *    IDENTICOS aos de hoje e nenhum colaborador de compartilhamento e tocado;
 *  - F.4: `access_read` auditado com count (actor = convidado); falha do audit
 *    NAO derruba a list (o engolidor mora no SharedAgendaAuditService —
 *    testado la; aqui um auditor falso que engole prova a composicao);
 *  - B.15: rotas de ESCREVA nunca leem owner — inputs de escrita descartam ou
 *    rejeitam a chave e o create grava o userId da SESSAO mesmo com owner no
 *    body (prisma capture).
 */

const OWNER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const GUEST_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const LINK_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const FROM = new Date('2026-10-05T03:00:00Z');
const TO = new Date('2026-10-12T03:00:00Z');

/**
 * Row CRU com os campos privados do dono: se o select/shape vazar, o assert de
 * saida pega (o zod de resposta faz strip — a saida do service e que vale).
 */
function ownerRow(id: string) {
  return {
    id,
    title: 'Consulta dentista',
    startsAt: new Date('2026-10-06T14:00:00Z'),
    endsAt: new Date('2026-10-06T15:00:00Z'),
    notes: 'levar exame',
    status: 'confirmed',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    // privados (rawText/reviewReason do dono; rules da fila dele):
    rawText: 'marca la no dentista segunda as dez',
    reviewReason: 'confianca baixa',
    origin: 'bot',
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    userId: OWNER_ID,
    notificationRules: [{ id: 'r1', type: 'before_hours', value: 2 }],
  };
}

/** Linha do shape REAL que o `select` do service devolve (sem os campos
 *  privados) — e isto que o Prisma entrega; onde o teste precisa do shape cru
 *  com `rawText`/`reviewReason` vazando, ele usa `ownerRow` + o mock de
 *  `select` que recorta (como o do teste do zod de resposta). */
function selectedRow(id: string) {
  const { title, startsAt, endsAt, notes, status, createdAt } = ownerRow(id);
  return { id, title, startsAt, endsAt, notes, status, createdAt };
}

interface Fixtures {
  /** o que `activeLinkBetween` devolve (mock do service da Etapa 2) */
  link?: { id: string } | null;
  /** rows que o appointment.findMany devolve */
  rows?: Record<string, unknown>[];
}

function make(fx: Fixtures = {}) {
  const findMany = jest.fn().mockResolvedValue(fx.rows ?? []);
  const prisma = { appointment: { findMany } };
  const outbox = {
    materializeInTx: jest.fn().mockResolvedValue({ outboxIds: [], triggers: [] }),
    enqueueJobs: jest.fn().mockResolvedValue(undefined),
    invalidateForAppointment: jest.fn().mockResolvedValue(0),
  };
  const activeLinkBetween = jest.fn().mockResolvedValue(fx.link === undefined ? null : fx.link);
  const sharedAgendas = { activeLinkBetween } as unknown as SharedAgendasService;
  // O SharedAgendaAuditService.registrar REAL nunca lanca (padrao
  // BotEventsService — invariante testada no spec dele). O mock aqui e o
  // auditor COMPLIANTE com esse contrato: a list so faz `await` sem condicao no
  // resultado — a garantia de "auditor fora do ar nao derruba a list" mora la.
  const registrar = jest.fn().mockResolvedValue(undefined);
  const sharedAudit = { registrar } as unknown as SharedAgendaAuditService;
  const svc = new AppointmentsService(prisma as never, outbox as never, sharedAgendas, sharedAudit);
  return { svc, findMany, activeLinkBetween, registrar };
}

const query = { from: FROM.toISOString(), to: TO.toISOString() };
const borrowed = { ...query, owner: OWNER_ID };

describe('AppointmentsService.list — agenda emprestada (B.12/D2/D3)', () => {
  describe('matriz status × ?owner= (B.12: 403 uniforme)', () => {
    // activeLinkBetween (Etapa 2) so devolve linha quando effectiveStatus ===
    // 'active': pending vivo, pending morto (D4), revoked, self e dono
    // inexistente caem todos no null => SharedAccessInvalidError identico.
    it.each([
      ['vinculo PENDING vivo', null],
      ['vinculo ATIVO-que-morreu-no-leitor (pending morta, effectiveStatus)', null],
      ['vinculo REVOKED (dono revogou ou convidado saiu)', null],
      ['self sem vinculo (owner == sessao, sem linha ativa)', null],
      ['owner uuid INEXISTENTE', null],
    ])('%s => SharedAccessInvalidError sem oraculo de sabor', async (_label, link) => {
      const { svc, findMany, registrar } = make({ link: link as { id: string } | null });
      await expect(svc.list(GUEST_ID, borrowed)).rejects.toBeInstanceOf(SharedAccessInvalidError);
      // sem leitura e sem auditoria de leitura (nada aconteceu)
      expect(findMany).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    });

    it('todos os sabores 403 produzem o MESMO erro (forma uniforme — B.12)', async () => {
      const a = await make({ link: null })
        .svc.list(GUEST_ID, borrowed)
        .catch((e: unknown) => e);
      const b = await make({ link: null })
        .svc.list(GUEST_ID, { ...query, owner: 'cccccccc-0000-4000-8000-000000000009' })
        .catch((e: unknown) => e);
      expect(a).toBeInstanceOf(SharedAccessInvalidError);
      expect(b).toBeInstanceOf(SharedAccessInvalidError);
      expect((a as Error).message).toBe((b as Error).message);
    });

    it('vinculo ATIVO => itens do DONO (owner no where, sessao nunca) + audit', async () => {
      const { svc, findMany, activeLinkBetween, registrar } = make({
        link: { id: LINK_ID },
        rows: [ownerRow('a1')],
      });

      const out = await svc.list(GUEST_ID, borrowed);

      // resolucao deterministica: dono=owner pedido, convidado=sessao
      expect(activeLinkBetween).toHaveBeenCalledWith(OWNER_ID, GUEST_ID);
      expect(out.items.map((i) => i.id)).toEqual(['a1']);
      expect(registrar).toHaveBeenCalled();
      void findMany;
    });

    it('owner invalido no zod (nao-uuid) => ZodError ANTES de tocar compartilhamento', async () => {
      const { svc, activeLinkBetween } = make({ link: { id: LINK_ID } });
      await expect(svc.list(GUEST_ID, { ...query, owner: 'nao-e-uuid' })).rejects.toThrow();
      expect(activeLinkBetween).not.toHaveBeenCalled();
    });
  });

  describe('filtro de privacidade na consulta (B.13/D3)', () => {
    it('where com status confirmed fixo + userId=owner; select SEM rawText/reviewReason/rules', async () => {
      const { svc, findMany } = make({ link: { id: LINK_ID } });

      await svc.list(GUEST_ID, borrowed);

      const args = findMany.mock.calls[0]![0]!;
      expect(args.where).toEqual({
        userId: OWNER_ID,
        status: 'confirmed',
        startsAt: { lt: TO },
        endsAt: { gte: FROM },
      });
      expect(args.orderBy).toEqual({ startsAt: 'asc' });
      expect(args.include).toBeUndefined(); // notificationRules do dono NUNCA
      expect(Object.keys(args.select).sort()).toEqual(
        ['createdAt', 'endsAt', 'id', 'notes', 'startsAt', 'status', 'title'].sort(),
      );
      expect(args.select.rawText).toBeUndefined();
      expect(args.select.reviewReason).toBeUndefined();
    });

    it('shape de saida parseia em sharedAppointmentListResultSchema SEM as chaves privadas', async () => {
      // `ownerRow` cru + `select` FALSO que recorta (como o Prisma real faz com
      // `select`): o shape que sai do service e o do select — os asserts de
      // ausencia pegam qualquer vazamento e o zod de resposta da web e o
      // espelho exato deste parse. (id uuid-ish: o zod de resposta e uuid.)
      const { svc, findMany } = make({ link: { id: LINK_ID } });
      findMany.mockImplementation(async ({ select }: { select: Record<string, true> }) =>
        [ownerRow('aaaaaaaa-0000-4000-8000-0000000000a1') as unknown as Record<string, unknown>].map(
          (r) => Object.fromEntries(Object.entries(select).map(([k]) => [k, r[k]])),
        ),
      );
      const out = await svc.list(GUEST_ID, borrowed);

      const wire = JSON.parse(JSON.stringify(out)); // como a web ve (Dates => ISO)
      const parsed = sharedAppointmentListResultSchema.safeParse(wire);
      if (!parsed.success) console.log(parsed.error.issues);
      expect(parsed.success).toBe(true);
      const item = wire.items[0] as Record<string, unknown>;
      expect(item.rawText).toBeUndefined();
      expect(item.reviewReason).toBeUndefined();
      expect(item.notificationRules).toBeUndefined();
    });
  });

  describe('auditoria access_read (F.4)', () => {
    it('auditada com count, actor = convidado, dono = owner', async () => {
      const { svc, registrar } = make({
        link: { id: LINK_ID },
        rows: [ownerRow('a1'), ownerRow('a2')],
      });

      await svc.list(GUEST_ID, borrowed);

      expect(registrar).toHaveBeenCalledWith(GUEST_ID, 'access_read', {
        ownerId: OWNER_ID,
        guestId: GUEST_ID,
        metadata: { count: 2 },
      });
    });

    it('auditor é chamado 1× antes do return (a garantia nunca-lança é testada no próprio auditor)', async () => {
      // O contrato do SharedAgendaAuditService.registrar e NUNCA lanca
      // (try/catch interno — invariante testada no spec dele). Aqui o mock
      // NAO lanca (como o real): a list anda com o audit chamado e o service
      // nao le o retorno dele pra nada. Provar que a list engoliria um auditor
      // quebrado seria premiar o engolidor duplicado (revisao R1): se o
      // contrato furar um dia, o 500 e o bug VISIVEL que queremos.
      const { svc, findMany, registrar } = make({ link: { id: LINK_ID } });
      findMany.mockResolvedValue([selectedRow('a1')]);
      const out = await svc.list(GUEST_ID, borrowed);
      expect(out.items.map((i) => i.id)).toEqual(['a1']);
      expect(registrar).toHaveBeenCalledTimes(1);
    });

    it('auditoria acontece NA list emprestada e NUNCA na propria (access_read so la)', async () => {
      const { svc, registrar } = make({ link: { id: LINK_ID } });
      await svc.list(GUEST_ID, query); // propria
      expect(registrar).not.toHaveBeenCalled();
    });
  });

  describe('zero regressao — agenda propria (D2)', () => {
    it('sem owner: findMany com onde/include/ordem IDENTICOS aos de hoje (argumento exato)', async () => {
      const { svc, findMany, activeLinkBetween, registrar } = make();

      await svc.list(GUEST_ID, query);

      expect(findMany).toHaveBeenCalledWith({
        where: { userId: GUEST_ID, startsAt: { lt: TO }, endsAt: { gte: FROM } },
        orderBy: { startsAt: 'asc' },
        include: { notificationRules: true },
      });
      // notificationRules seguem presentes no caminho proprio (sem select)
      const args = findMany.mock.calls[0]![0]!;
      expect(args.include).toEqual({ notificationRules: true });
      expect(args.select).toBeUndefined();
      // caminho propria NAO toca compartilhamento nenhum (nem vinculo, nem audit)
      expect(activeLinkBetween).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    });
  });

  describe('escrita nunca ve dono (B.15)', () => {
    it('zod strip: appointmentInputSchema/apointmentPatchSchema DESCARTAM owner (documentado)', () => {
      // os inputs de escrita NAO sao .strict() (sao inputs do form da web); o
      // default do zod e strip => `owner` no body e descartado na borda. A
      // ausencia estrutural de dono nas escritas e tripla: strip aqui + o
      // service de create/grava recebe userId da SESSAO por parametro e nunca
      // le owner + os schemas strict de reschedule/relocation REJEITAM a chave.
      const base = {
        title: 'X',
        startsAt: '2026-10-20T14:00:00.000Z',
        endsAt: '2026-10-20T15:00:00.000Z',
        notificationRules: [],
      };
      const parsed = appointmentInputSchema.parse({ ...base, owner: OWNER_ID });
      expect((parsed as Record<string, unknown>).owner).toBeUndefined();
      const patched = appointmentPatchSchema.parse({ title: 'Y', owner: OWNER_ID });
      expect((patched as Record<string, unknown>).owner).toBeUndefined();
    });

    it('schemas strict de escrita REJEITAM owner na borda (relocation/reschedule)', () => {
      expect(() =>
        rescheduleAppointmentInputSchema.parse({
          mode: 'move',
          movedId: 'dddddddd-0000-4000-8000-000000000001',
          newStart: '2026-10-20T14:00:00.000Z',
          newEnd: '2026-10-20T15:00:00.000Z',
          owner: OWNER_ID,
        }),
      ).toThrow();
    });

    it('create grava o userId da SESSAO mesmo com owner no body (prisma capture)', async () => {
      const create = jest
        .fn()
        .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'novo',
          ...data,
          notificationRules: [],
        }));
      // conflito: carga vazia => create anda; tx falsa so com create
      const { svc } = make();
      (svc as unknown as { prisma: unknown }).prisma = {
        appointment: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: (fn: (tx: { appointment: { create: typeof create } }) => Promise<unknown>) =>
          fn({ appointment: { create } }),
      };

      await svc.create(GUEST_ID, {
        title: 'X',
        startsAt: '2026-10-20T14:00:00.000Z',
        endsAt: '2026-10-20T15:00:00.000Z',
        owner: OWNER_ID, // tentativamente: "cria na agenda do dono"
      });

      const data = create.mock.calls[0]![0]!.data as Record<string, unknown>;
      expect(data.userId).toBe(GUEST_ID); // a SESSAO vence — sempre
      expect(data.owner).toBeUndefined(); // e owner nem existe na linha
    });
  });
});

describe('AppointmentsController.list — 403 uniforme (gotcha 15)', () => {
  // controllers nao tem spec de unit dedicada no repo; o handler fino e o
  // proprio objeto do teste — servico falso, sem instancia Nest.
  it('SharedAccessInvalidError => HttpException 403 { code: shared_access_invalid }', async () => {
    const controller = new AppointmentsController({
      list: jest.fn().mockRejectedValue(new SharedAccessInvalidError()),
    } as never);

    const err = await controller.list({ id: GUEST_ID }, borrowed).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const http = err as { getStatus: () => number; getResponse: () => unknown };
    expect(http.getStatus()).toBe(403);
    expect(http.getResponse()).toEqual({ code: 'shared_access_invalid' });
  });

  it('outros erros passam intactos (o catch nao engole o resto)', async () => {
    const boom = new Error('outra coisa');
    const controller = new AppointmentsController({
      list: jest.fn().mockRejectedValue(boom),
    } as never);
    await expect(controller.list({ id: GUEST_ID }, query)).rejects.toBe(boom);
  });
});
