import { api } from '@/lib/api'
import type { Company } from '@/types'

export const companiesApi = {
  list: (activeOnly = false) =>
    api.get<Company[]>('/companies', { params: activeOnly ? { active_only: true } : {} }),

  create: (name: string) => api.post<Company>('/companies', { name }),

  update: (id: string, data: { name?: string; is_active?: boolean }) =>
    api.patch<Company>(`/companies/${id}`, data),

  remove: (id: string) => api.delete(`/companies/${id}`),
}
