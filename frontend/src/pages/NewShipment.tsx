import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { shipmentsApi } from '@/api/shipments'
import { mastersApi } from '@/api/masters'
import { CreatableSelect } from '@/components/CreatableSelect'
import toast from 'react-hot-toast'

export function NewShipment() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    bl_number: '',
    invoice_number: '',
    container_count: '',
    pull_out_date: '',
    product_type_id: '',
    loading_port_id: '',
    shipping_line_id: '',
    offloading_point_id: '',
    remark: '',
  })

  const { data: productTypes = [] } = useQuery({ queryKey: ['productTypes'], queryFn: () => mastersApi.productTypes.list().then(r => r.data) })
  const { data: loadingPorts = [] } = useQuery({ queryKey: ['loadingPorts'], queryFn: () => mastersApi.loadingPorts.list().then(r => r.data) })
  const { data: shippingLines = [] } = useQuery({ queryKey: ['shippingLines'], queryFn: () => mastersApi.shippingLines.list().then(r => r.data) })
  const { data: offloadingPoints = [] } = useQuery({ queryKey: ['offloadingPoints'], queryFn: () => mastersApi.offloadingPoints.list().then(r => r.data) })

  function set(field: string, value: string) {
    setForm(p => ({ ...p, [field]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const containerCount = parseInt(form.container_count, 10)
    if (!form.bl_number.trim() || !form.invoice_number.trim()) {
      toast.error('BL number and Invoice number are required')
      return
    }
    if (!form.container_count || isNaN(containerCount) || containerCount < 1 || containerCount > 99) {
      toast.error('Container count must be a whole number between 1 and 99')
      return
    }
    if (!form.product_type_id || !form.loading_port_id || !form.shipping_line_id || !form.offloading_point_id) {
      toast.error('Product type, loading port, shipping line and offloading location are required')
      return
    }
    setSubmitting(true)
    try {
      const { data } = await shipmentsApi.create({
        bl_number: form.bl_number.trim(),
        invoice_number: form.invoice_number.trim(),
        container_count: containerCount,
        pull_out_date: form.pull_out_date || undefined,
        product_type_id: form.product_type_id || undefined,
        loading_port_id: form.loading_port_id || undefined,
        shipping_line_id: form.shipping_line_id || undefined,
        remark: form.remark.trim() || undefined,
      })
      toast.success('Shipment created — please upload your documents')
      navigate(`/shipments/${data.id}`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create shipment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">New Shipment</h1>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">BL Number <span className="text-red-500">*</span></label>
          <input
            value={form.bl_number}
            onChange={e => set('bl_number', e.target.value)}
            required
            placeholder="e.g. MAEU123456789"
            className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Number <span className="text-red-500">*</span></label>
          <input
            value={form.invoice_number}
            onChange={e => set('invoice_number', e.target.value)}
            required
            placeholder="e.g. INV-2024-001"
            className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Number of Containers <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={1}
            max={99}
            value={form.container_count}
            onChange={e => set('container_count', e.target.value)}
            required
            placeholder="e.g. 2"
            className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            As declared on the B/L — FFD can adjust the count when opening the CCRO task if needed
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pull-out Date</label>
          <input
            type="date"
            value={form.pull_out_date}
            onChange={e => set('pull_out_date', e.target.value)}
            className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Helps FFD team prioritise your shipment</p>
        </div>

        <CreatableSelect
          label="Product Type"
          value={form.product_type_id}
          onChange={v => set('product_type_id', v)}
          options={productTypes}
          required
          onAdd={async name => {
            const { data } = await mastersApi.productTypes.create(name)
            qc.invalidateQueries({ queryKey: ['productTypes'] })
            return data
          }}
        />

        <CreatableSelect
          label="Loading Port"
          value={form.loading_port_id}
          onChange={v => set('loading_port_id', v)}
          options={loadingPorts}
          required
          onAdd={async name => {
            const { data } = await mastersApi.loadingPorts.create(name)
            qc.invalidateQueries({ queryKey: ['loadingPorts'] })
            return data
          }}
        />

        <CreatableSelect
          label="Shipping Line"
          value={form.shipping_line_id}
          onChange={v => set('shipping_line_id', v)}
          options={shippingLines}
          required
          onAdd={async name => {
            const { data } = await mastersApi.shippingLines.create(name)
            qc.invalidateQueries({ queryKey: ['shippingLines'] })
            return data
          }}
        />

        <CreatableSelect
          label="Offloading Location"
          value={form.offloading_point_id}
          onChange={v => set('offloading_point_id', v)}
          options={offloadingPoints}
          required
          onAdd={async name => {
            const { data } = await mastersApi.offloadingPoints.create(name)
            qc.invalidateQueries({ queryKey: ['offloadingPoints'] })
            return data
          }}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Remarks <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span></label>
          <textarea
            value={form.remark}
            onChange={e => set('remark', e.target.value)}
            rows={3}
            placeholder="Any notes for the FFD team…"
            className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div className="pt-2 flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Shipment'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
