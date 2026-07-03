import { api } from '@/lib/api'

export interface CCConfig {
  id: string
  team: string | null
  pro_user_id: string | null
  company_id: string | null
  company_name: string | null
  cc_email: string
}

export interface CCConfigCreate {
  team?: string
  pro_user_id?: string
  company_id?: string
  cc_email: string
}

export interface DailyReportConfig {
  send_time: string
  last_sent_date: string | null
}

export interface DailyReportRecipient {
  id: string
  email: string
}

export interface AppNotification {
  id: string
  shipment_id: string | null
  template: string
  payload: { subject: string; body: string }
  is_read: boolean
  created_at: string
}

export const notificationsApi = {
  // Alert CC configs
  listCCConfigs: () => api.get<CCConfig[]>('/notifications/cc-configs'),
  createCCConfig: (data: CCConfigCreate) => api.post<CCConfig>('/notifications/cc-configs', data),
  deleteCCConfig: (id: string) => api.delete(`/notifications/cc-configs/${id}`),

  // Daily report config
  getDailyReportConfig: () => api.get<DailyReportConfig>('/notifications/daily-report/config'),
  updateDailyReportConfig: (send_time: string) =>
    api.patch<DailyReportConfig>('/notifications/daily-report/config', { send_time }),

  // Daily report recipients
  listDailyReportRecipients: () =>
    api.get<DailyReportRecipient[]>('/notifications/daily-report/recipients'),
  addDailyReportRecipient: (email: string) =>
    api.post<DailyReportRecipient>('/notifications/daily-report/recipients', { email }),
  removeDailyReportRecipient: (id: string) =>
    api.delete(`/notifications/daily-report/recipients/${id}`),

  // Manual trigger
  sendDailyReportNow: () => api.post('/notifications/daily-report/send'),

  // In-app notifications
  getMyNotifications: () => api.get<AppNotification[]>('/notifications/my'),
  markRead: (ids: string[]) => api.post('/notifications/mark-read', { ids }),
  markAllRead: () => api.post('/notifications/mark-read', { all: true }),
}
