import { useQuery } from '@tanstack/vue-query';
import { reviewListResultSchema } from '@agendabo/contracts';
import { reviewApi } from '../../services/review';
import { qk } from '../../config/queryKeys';

/** GET /review — fila needs_review (a ordem é a da API; a página reordena se quiser). */
export function useReviewQuery() {
  return useQuery({
    queryKey: qk.review,
    queryFn: async () => reviewListResultSchema.parse(await reviewApi.list()),
  });
}
