import Logo from '../../components/Logo'
import GroceryListBody from './GroceryListBody'

export default function GroceryList({ userId }) {
  return (
    <div className="mobile-screen pb-28">
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">Grocery List</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <GroceryListBody userId={userId} />
      </div>
    </div>
  )
}
