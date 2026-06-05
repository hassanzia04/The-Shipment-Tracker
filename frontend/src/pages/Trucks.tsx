import { TrucksMaster } from './admin/Masters'

export function Trucks() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trucks</h1>
      <TrucksMaster />
    </div>
  )
}
