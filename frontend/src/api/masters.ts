import { api } from '@/lib/api'
import type { Truck, MasterItem } from '@/types'

export const mastersApi = {
  trucks: {
    list: () => api.get<Truck[]>('/masters/trucks'),
    create: (data: { plate_number: string; driver_name: string; contractor: string; nationality: string }) =>
      api.post<Truck>('/masters/trucks', data),
    import: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/masters/trucks/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    template: () => api.get('/masters/trucks/template', { responseType: 'blob' }),
  },
  productTypes: {
    list: () => api.get<MasterItem[]>('/masters/product-types'),
    create: (name: string) => api.post<MasterItem>('/masters/product-types', { name }),
    delete: (id: string) => api.delete(`/masters/product-types/${id}`),
    import: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/masters/product-types/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    template: () => api.get('/masters/product-types/template', { responseType: 'blob' }),
  },
  ropTypes: {
    list: () => api.get<MasterItem[]>('/masters/rop-inspection-types'),
    create: (name: string) => api.post<MasterItem>('/masters/rop-inspection-types', { name }),
    import: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/masters/rop-inspection-types/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
  },
  offloadingPoints: {
    list: () => api.get<MasterItem[]>('/masters/offloading-points'),
    create: (name: string) => api.post<MasterItem>('/masters/offloading-points', { name }),
    delete: (id: string) => api.delete(`/masters/offloading-points/${id}`),
    import: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/masters/offloading-points/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    template: () => api.get('/masters/offloading-points/template', { responseType: 'blob' }),
  },
  loadingPorts: {
    list: () => api.get<MasterItem[]>('/masters/loading-ports'),
    create: (name: string) => api.post<MasterItem>('/masters/loading-ports', { name }),
    delete: (id: string) => api.delete(`/masters/loading-ports/${id}`),
    import: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/masters/loading-ports/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    template: () => api.get('/masters/loading-ports/template', { responseType: 'blob' }),
  },
  shippingLines: {
    list: () => api.get<MasterItem[]>('/masters/shipping-lines'),
    create: (name: string) => api.post<MasterItem>('/masters/shipping-lines', { name }),
    delete: (id: string) => api.delete(`/masters/shipping-lines/${id}`),
    import: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/masters/shipping-lines/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    template: () => api.get('/masters/shipping-lines/template', { responseType: 'blob' }),
  },
}
