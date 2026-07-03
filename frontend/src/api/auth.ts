import { api } from '@/lib/api'
import type { User } from '@/types'

export const authApi = {
  // Backend sets HttpOnly auth cookies and returns the authenticated user
  login: (email: string, password: string) =>
    api.post<User>('/auth/login', { email, password }),

  // Clears auth cookies server-side
  logout: () => api.post('/auth/logout'),

  me: () => api.get<User>('/auth/me'),

  register: (token: string, full_name: string, password: string) =>
    api.post<User>('/auth/register', { token, full_name, password }),

  validateInvite: (token: string) =>
    api.get<{ email: string; team: string; company_name: string | null }>(`/auth/invite/${token}`),

  invite: (email: string, team: string, company_id?: string | null) =>
    api.post('/auth/invite', { email, team, company_id: company_id || null }),

  listUsers: () => api.get<User[]>('/auth/users'),

  createUser: (data: { full_name: string; email: string; password: string; team: string; company_id?: string | null }) =>
    api.post<User>('/auth/users', data),

  listTeamMembers: (team: string) => api.get<User[]>(`/auth/team/${team}`),

  listTeamWorkload: (team: string) =>
    api.get<{ id: string; full_name: string; active_task_count: number }[]>(`/auth/team/${team}/workload`),

  toggleActive: (userId: string, active: boolean) =>
    api.patch(`/auth/users/${userId}/toggle-active`, null, { params: { active } }),

  updateTeam: (userId: string, team: string, company_id?: string | null) =>
    api.patch(`/auth/users/${userId}/team`, { team, company_id: company_id || null }),

  updateCompany: (userId: string, company_id: string | null) =>
    api.patch(`/auth/users/${userId}/company`, { company_id }),

  updateFocusCompanies: (companyIds: string[]) =>
    api.patch<User>('/auth/me/focus-companies', { company_ids: companyIds }),

  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),
}
