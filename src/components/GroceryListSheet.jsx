import { Sheet } from 'react-modal-sheet'
import { ShoppingCart, X } from 'lucide-react'
import GroceryListBody from '../pages/GroceryList/GroceryListBody'

export default function GroceryListSheet({ isOpen, userId, onClose }) {
  return (
    <Sheet isOpen={isOpen} onClose={onClose} detent="content-height">
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-5 pt-2 pb-safe max-h-[85vh] overflow-y-auto" role="dialog" aria-label="Grocery list">
            <div className="flex items-center justify-between mb-3">
              <p className="section-heading text-brand-700 flex items-center gap-2">
                <ShoppingCart size={14} />
                Grocery list
              </p>
              <button
                onClick={onClose}
                aria-label="Close grocery list"
                className="btn-icon"
              >
                <X size={18} />
              </button>
            </div>
            <GroceryListBody userId={userId} />
          </div>
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onClick={onClose} />
    </Sheet>
  )
}
