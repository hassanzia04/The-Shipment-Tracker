import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { mastersApi } from '@/api/masters'
import { useSortable } from '@/lib/sort'
import { SortableHeader } from '@/components/SortableHeader'
import toast from 'react-hot-toast'
import { Upload, Download, Plus, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

type MasterKey = 'productTypes' | 'offloadingPoints' | 'loadingPorts' | 'shippingLines' | 'bayanTypes' | 'consignees'
const MASTER_CONFIG: { key: MasterKey; label: string; api: any }[] = [
  { key: 'productTypes', label: 'Product Types', api: mastersApi.productTypes },
  { key: 'loadingPorts', label: 'Loading Ports', api: mastersApi.loadingPorts },
  { key: 'shippingLines', label: 'Shipping Lines', api: mastersApi.shippingLines },
  { key: 'offloadingPoints', label: 'Offloading Locations', api: mastersApi.offloadingPoints },
  { key: 'bayanTypes', label: 'Bayan Types', api: mastersApi.bayanTypes },
  { key: 'consignees', label: 'Consignees', api: mastersApi.consignees },
]

export function AdminMasters() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [newName, setNewName] = useState<Record<MasterKey, string>>({ productTypes: '', offloadingPoints: '', loadingPorts: '', shippingLines: '', bayanTypes: '', consignees: '' })

  // Transport only works with trucks — the other masters aren't theirs to manage
  const trucksOnly = user?.team === 'TRANSPORT' && !user?.is_admin

  const queries = MASTER_CONFIG.map(m => ({
    ...m,
    query: useQuery({ queryKey: [m.key], queryFn: () => m.api.list().then((r: any) => r.data), enabled: !trucksOnly }),
  }))

  async function addItem(cfg: typeof MASTER_CONFIG[0]) {
    const name = newName[cfg.key].trim()
    if (!name) return
    try {
      await cfg.api.create(name)
      qc.invalidateQueries({ queryKey: [cfg.key] })
      setNewName(p => ({ ...p, [cfg.key]: '' }))
      toast.success('Added')
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
  }

  async function importExcel(cfg: typeof MASTER_CONFIG[0], file: File) {
    try {
      const result = await cfg.api.import(file)
      qc.invalidateQueries({ queryKey: [cfg.key] })
      toast.success(`Imported ${(result.data as any).inserted} rows`)
    } catch { toast.error('Import failed') }
  }

  async function deleteItem(cfg: typeof MASTER_CONFIG[0], id: string) {
    if (!('delete' in cfg.api)) return
    try {
      await (cfg.api as any).delete(id)
      qc.invalidateQueries({ queryKey: [cfg.key] })
      toast.success('Deleted')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to delete')
    }
  }

  async function downloadTemplate(cfg: typeof MASTER_CONFIG[0]) {
    if (!('template' in cfg.api)) return
    const { data } = await (cfg.api as any).template()
    const url = URL.createObjectURL(new Blob([data]))
    const a = document.createElement('a')
    a.href = url; a.download = `${cfg.key}_template.xlsx`; a.click()
    URL.revokeObjectURL(url)
  }

  if (trucksOnly) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Master Data</h1>
        <TrucksMaster />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Master Data</h1>

      {/* Trucks — not shown to customer teams */}
      {user?.team !== 'CUSTOMER' && user?.team !== 'CUSTOMER_MANAGEMENT' && <TrucksMaster />}

      {/* Outsourced Trucks — not shown to customer teams */}
      {user?.team !== 'CUSTOMER' && user?.team !== 'CUSTOMER_MANAGEMENT' && <OutsourcedTrucksMaster />}

      {queries.map(({ key, label, api, query }) => (
        <div key={key} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">{label}</h2>
            <div className="flex gap-2">
              {'template' in api && (
                <button onClick={() => downloadTemplate({ key, label, api })} className="flex items-center gap-1 text-xs border dark:border-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                  <Download size={12} /> Template
                </button>
              )}
              <label className="flex items-center gap-1 text-xs border dark:border-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                <Upload size={12} /> Import Excel
                <input type="file" accept=".xlsx" className="hidden" onChange={e => e.target.files?.[0] && importExcel({ key, label, api }, e.target.files[0])} />
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              value={newName[key]}
              onChange={e => setNewName(p => ({ ...p, [key]: e.target.value }))}
              placeholder={`Add ${label.toLowerCase()}…`}
              className="flex-1 text-sm border dark:border-gray-600 rounded px-2.5 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              onKeyDown={e => e.key === 'Enter' && addItem({ key, label, api })}
            />
            <button onClick={() => addItem({ key, label, api })} className="flex items-center gap-1 text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {(query.data || []).map((item: any) => (
              <span key={item.id} className="group/pill flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2.5 py-1 rounded-full">
                {item.name}
                {user?.is_admin && (
                  <button
                    onClick={() => deleteItem({ key, label, api }, item.id)}
                    className="opacity-0 group-hover/pill:opacity-100 transition-opacity ml-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const TRUCKS_PAGE_SIZE = 20

export function TrucksMaster() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data: rawTrucks = [] } = useQuery({ queryKey: ['trucks'], queryFn: () => mastersApi.trucks.list().then(r => r.data) })
  const { sorted: sortedTrucks, sort: truckSort, toggle: truckToggle } = useSortable(rawTrucks, (t: any, col) => {
    switch (col) {
      case 'plate':       return t.plate_number
      case 'driver':      return t.driver_name
      case 'contractor':  return t.contractor
      case 'nationality': return t.nationality
      default:            return null
    }
  })
  const [form, setForm] = useState({ plate_number: '', driver_name: '', contractor: '', nationality: '' })
  const [truckPage, setTruckPage] = useState(1)

  async function add() {
    if (!form.plate_number.trim()) return
    try {
      await mastersApi.trucks.create(form)
      qc.invalidateQueries({ queryKey: ['trucks'] })
      setForm({ plate_number: '', driver_name: '', contractor: '', nationality: '' })
      toast.success('Truck added')
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
  }

  async function deleteTruck(id: string) {
    if (!confirm('Delete this truck? This cannot be undone.')) return
    try {
      await mastersApi.trucks.delete(id)
      qc.invalidateQueries({ queryKey: ['trucks'] })
      toast.success('Truck deleted')
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed to delete') }
  }

  async function importExcel(file: File) {
    try {
      const result = await mastersApi.trucks.import(file)
      qc.invalidateQueries({ queryKey: ['trucks'] })
      toast.success(`Imported ${(result.data as any).inserted} trucks`)
    } catch { toast.error('Import failed') }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">Trucks</h2>
        <div className="flex gap-2">
          <button onClick={async () => { const { data } = await mastersApi.trucks.template(); const url = URL.createObjectURL(new Blob([data])); const a = document.createElement('a'); a.href = url; a.download = 'trucks_template.xlsx'; a.click() }} className="flex items-center gap-1 text-xs border dark:border-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700">
            <Download size={12} /> Template
          </button>
          <label className="flex items-center gap-1 text-xs border dark:border-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <Upload size={12} /> Import Excel
            <input type="file" accept=".xlsx" className="hidden" onChange={e => e.target.files?.[0] && importExcel(e.target.files[0])} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[{ key: 'plate_number', ph: 'Plate number' }, { key: 'driver_name', ph: 'Driver name' }, { key: 'contractor', ph: 'Contractor' }, { key: 'nationality', ph: 'Nationality' }].map(({ key, ph }) => (
          <input key={key} value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={ph} className="text-sm border dark:border-gray-600 rounded px-2.5 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
        ))}
      </div>
      <button onClick={add} className="flex items-center gap-1 text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
        <Plus size={14} /> Add Truck
      </button>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
            <SortableHeader label="Plate"       column="plate"       sort={truckSort} onSort={truckToggle} className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
            <SortableHeader label="Driver"      column="driver"      sort={truckSort} onSort={truckToggle} className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
            <SortableHeader label="Contractor"  column="contractor"  sort={truckSort} onSort={truckToggle} className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
            <SortableHeader label="Nationality" column="nationality" sort={truckSort} onSort={truckToggle} className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
            {user?.is_admin && <th className="py-2" />}
          </tr></thead>
          <tbody>
            {sortedTrucks.slice((truckPage - 1) * TRUCKS_PAGE_SIZE, truckPage * TRUCKS_PAGE_SIZE).map((t: any) => (
              <tr key={t.id} className="border-b dark:border-gray-700 last:border-0 dark:text-gray-300">
                <td className="py-2 pr-4 font-medium dark:text-gray-100">{t.plate_number}</td>
                <td className="py-2 pr-4">{t.driver_name}</td>
                <td className="py-2 pr-4">{t.contractor}</td>
                <td className="py-2 pr-4">{t.nationality}</td>
                {user?.is_admin && (
                  <td className="py-2">
                    <button onClick={() => deleteTruck(t.id)} className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400">
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}

          </tbody>
        </table>
      </div>
      {rawTrucks.length > TRUCKS_PAGE_SIZE && (
        <div className="flex items-center justify-between pt-2 border-t dark:border-gray-700">
          <span className="text-xs text-gray-500 dark:text-gray-400">{rawTrucks.length} trucks total</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTruckPage(p => Math.max(1, p - 1))}
              disabled={truckPage === 1}
              className="px-2.5 py-1 text-xs border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 dark:text-gray-300"
            >
              Prev
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 px-2">
              {truckPage} / {Math.ceil(rawTrucks.length / TRUCKS_PAGE_SIZE)}
            </span>
            <button
              onClick={() => setTruckPage(p => Math.min(Math.ceil(rawTrucks.length / TRUCKS_PAGE_SIZE), p + 1))}
              disabled={truckPage === Math.ceil(rawTrucks.length / TRUCKS_PAGE_SIZE)}
              className="px-2.5 py-1 text-xs border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 dark:text-gray-300"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function OutsourcedTrucksMaster() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data: rawTrucks = [] } = useQuery({ queryKey: ['outsourcedTrucks'], queryFn: () => mastersApi.outsourcedTrucks.list().then(r => r.data) })
  const { sorted: sortedTrucks, sort: truckSort, toggle: truckToggle } = useSortable(rawTrucks, (t: any, col) => {
    switch (col) {
      case 'plate':       return t.plate_number
      case 'driver':      return t.driver_name
      case 'contractor':  return t.contractor
      case 'nationality': return t.nationality
      default:            return null
    }
  })
  const [form, setForm] = useState({ plate_number: '', driver_name: '', contractor: '', nationality: '' })
  const [page, setPage] = useState(1)

  async function add() {
    if (!form.plate_number.trim()) return
    try {
      await mastersApi.outsourcedTrucks.create(form)
      qc.invalidateQueries({ queryKey: ['outsourcedTrucks'] })
      setForm({ plate_number: '', driver_name: '', contractor: '', nationality: '' })
      toast.success('Outsourced truck added')
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
  }

  async function deactivate(id: string) {
    try {
      await mastersApi.outsourcedTrucks.deactivate(id)
      qc.invalidateQueries({ queryKey: ['outsourcedTrucks'] })
      toast.success('Deactivated')
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
  }

  async function deleteOutsourcedTruck(id: string) {
    if (!confirm('Delete this outsourced truck? This cannot be undone.')) return
    try {
      await mastersApi.outsourcedTrucks.delete(id)
      qc.invalidateQueries({ queryKey: ['outsourcedTrucks'] })
      toast.success('Outsourced truck deleted')
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed to delete') }
  }

  async function importExcel(file: File) {
    try {
      const result = await mastersApi.outsourcedTrucks.import(file)
      qc.invalidateQueries({ queryKey: ['outsourcedTrucks'] })
      toast.success(`Imported ${(result.data as any).inserted} trucks`)
    } catch { toast.error('Import failed') }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">Outsourced Trucks (Non-AMLS)</h2>
        <div className="flex gap-2">
          <button onClick={async () => { const { data } = await mastersApi.outsourcedTrucks.template(); const url = URL.createObjectURL(new Blob([data])); const a = document.createElement('a'); a.href = url; a.download = 'outsourced_trucks_template.xlsx'; a.click() }} className="flex items-center gap-1 text-xs border dark:border-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700">
            <Download size={12} /> Template
          </button>
          <label className="flex items-center gap-1 text-xs border dark:border-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <Upload size={12} /> Import Excel
            <input type="file" accept=".xlsx" className="hidden" onChange={e => e.target.files?.[0] && importExcel(e.target.files[0])} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[{ key: 'plate_number', ph: 'Plate number' }, { key: 'driver_name', ph: 'Driver name' }, { key: 'contractor', ph: 'Contractor' }, { key: 'nationality', ph: 'Nationality' }].map(({ key, ph }) => (
          <input key={key} value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={ph} className="text-sm border dark:border-gray-600 rounded px-2.5 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
        ))}
      </div>
      <button onClick={add} className="flex items-center gap-1 text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
        <Plus size={14} /> Add Outsourced Truck
      </button>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
            <SortableHeader label="Plate"       column="plate"       sort={truckSort} onSort={truckToggle} className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
            <SortableHeader label="Driver"      column="driver"      sort={truckSort} onSort={truckToggle} className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
            <SortableHeader label="Contractor"  column="contractor"  sort={truckSort} onSort={truckToggle} className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
            <SortableHeader label="Nationality" column="nationality" sort={truckSort} onSort={truckToggle} className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
            {user?.is_admin && <th className="py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"></th>}
          </tr></thead>
          <tbody>
            {sortedTrucks.slice((page - 1) * TRUCKS_PAGE_SIZE, page * TRUCKS_PAGE_SIZE).map((t: any) => (
              <tr key={t.id} className="border-b dark:border-gray-700 last:border-0 dark:text-gray-300">
                <td className="py-2 pr-4 font-medium dark:text-gray-100">{t.plate_number}</td>
                <td className="py-2 pr-4">{t.driver_name}</td>
                <td className="py-2 pr-4">{t.contractor}</td>
                <td className="py-2 pr-4">{t.nationality}</td>
                {user?.is_admin && (
                  <td className="py-2">
                    <div className="flex items-center gap-3">
                      <button onClick={() => deactivate(t.id)} className="text-xs text-orange-500 hover:text-orange-700 dark:hover:text-orange-400">
                        Deactivate
                      </button>
                      <button onClick={() => deleteOutsourcedTruck(t.id)} className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400">
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rawTrucks.length > TRUCKS_PAGE_SIZE && (
        <div className="flex items-center justify-between pt-2 border-t dark:border-gray-700">
          <span className="text-xs text-gray-500 dark:text-gray-400">{rawTrucks.length} outsourced trucks total</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2.5 py-1 text-xs border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 dark:text-gray-300">Prev</button>
            <span className="text-xs text-gray-500 dark:text-gray-400 px-2">{page} / {Math.ceil(rawTrucks.length / TRUCKS_PAGE_SIZE)}</span>
            <button onClick={() => setPage(p => Math.min(Math.ceil(rawTrucks.length / TRUCKS_PAGE_SIZE), p + 1))} disabled={page === Math.ceil(rawTrucks.length / TRUCKS_PAGE_SIZE)} className="px-2.5 py-1 text-xs border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 dark:text-gray-300">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
