import { Share2, Check, Loader2, Trash2, ShoppingCart, ThumbsUp, ThumbsDown, Pencil } from 'lucide-react'
import LastWeekCard from './LastWeekCard'
import MealPlanCard from './MealPlanCard'
import MaybeShortlist from './MaybeShortlist'
import { useBrainstorm, shortDateLabel } from './useBrainstorm'
import { Sheet } from 'react-modal-sheet'
import Logo from '../../components/Logo'
import GroceryListSheet from '../../components/GroceryListSheet'
import PeriodReview from '../PeriodReview'
import GapDayView from '../../components/GapDayView'
import DateRangePicker from '../../components/DateRangePicker'
import LeftoverPicker from '../../components/LeftoverPicker'
import DayPicker from '../../components/Brainstorm/DayPicker'

export default function BrainstormMode({ userId }) {
  const {
    loading,
    vault,
    lastWeek,
    plan,
    selectedDates,
    disabledDates,
    loadedPlan,
    planState,
    shortlist,
    preferences,
    storedRecentMeals,
    isServed,
    servedAt,
    servingPlan,
    serveError,
    justServed, setJustServed,
    serveSheetOpen, setServeSheetOpen,
    groceriesOpen, setGroceriesOpen,
    showReview, setShowReview,
    lockingIn,
    periodError,
    newPeriodStep,
    pendingRange,
    pendingLeftovers,
    startingPeriod,
    startPeriodError,
    sharing, setSharing,
    activeTab, setActiveTab,
    scheduleSheetItem, setScheduleSheetItem,
    shortlistError,
    pickerDate, setPickerDate,
    showResetConfirm, setShowResetConfirm,
    resetting,
    resetError, setResetError,
    canServe,
    dayGridDates,
    itemsByDate,
    canResetPlan,
    sensors,
    loadData,
    handleToggleCooked,
    handleScheduleFromShortlist,
    handleRemoveShortlist,
    handleMoveToMaybe,
    handleLockInAsIs,
    handleReviewFinalized,
    handleResetPlan,
    handleToggleDate,
    handleOpenPicker,
    handlePickerScheduled,
    handleDragEnd,
    handleServe,
    commitServe,
    openNewPeriodFlow,
    handleDateRangeConfirm,
    handleDateRangeCancel,
    handleLeftoverBack,
    handleLeftoverConfirm,
  } = useBrainstorm(userId)

  const handleShare = async () => {
    const text = [
      'Meal plan:',
      '',
      ...plan.map(slot => `${shortDateLabel(slot.scheduled_date)}: ${slot.name}`),
    ].join('\n')

    if (navigator.share) {
      setSharing(true)
      try {
        await navigator.share({ title: 'Meal plan', text })
      } catch {
        // User dismissed the share sheet — not an error
      }
      setSharing(false)
    } else {
      await navigator.clipboard.writeText(text)
      alert('Plan copied to clipboard!')
    }
  }

  if (loading) {
    return (
      <div className="mobile-screen items-center justify-center pb-28">
        <p className="helper-text">Building your plan…</p>
      </div>
    )
  }

  if (showReview && loadedPlan) {
    return (
      <PeriodReview
        plan={loadedPlan}
        userId={userId}
        showFinalizeButton={planState === 'ended_unfinalized'}
        onFinalized={handleReviewFinalized}
        onClose={() => setShowReview(false)}
      />
    )
  }

  if (planState === 'gap') {
    return (
      <>
        <GapDayView
          userId={userId}
          periodEnd={loadedPlan?.period_end ?? null}
          onStartNewPeriod={openNewPeriodFlow}
        />
        {startPeriodError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-red-50 border border-red-200 rounded-xl px-4 py-2 shadow-lg">
            <p className="text-xs text-red-700">{startPeriodError}</p>
          </div>
        )}
        {newPeriodStep === 'pick-dates' && (
          <DateRangePicker
            userId={userId}
            onCancel={handleDateRangeCancel}
            onConfirm={handleDateRangeConfirm}
          />
        )}
        {newPeriodStep === 'pick-leftovers' && pendingRange && (
          <LeftoverPicker
            leftovers={pendingLeftovers}
            periodStart={pendingRange.periodStart}
            periodEnd={pendingRange.periodEnd}
            onBack={handleLeftoverBack}
            onConfirm={handleLeftoverConfirm}
          />
        )}
        {startingPeriod && (
          <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center">
            <div className="bg-white rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-brand-700" />
              <span className="text-sm text-gray-700">Starting new period…</span>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="mobile-screen pb-28">

      {/* Header */}
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">Brainstorm meals</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* PRD-002 P0.6: This Week / Maybe segmented tab. */}
        <div
          role="tablist"
          aria-label="Plan view"
          className="grid grid-cols-2 gap-1 bg-cream-100 rounded-full p-1"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'thisWeek'}
            onClick={() => setActiveTab('thisWeek')}
            className={`py-3 min-h-[44px] rounded-full text-sm font-bold uppercase tracking-wider transition-colors ${
              activeTab === 'thisWeek'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-gray-700 hover:text-brand-700'
            }`}
          >
            This Week
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'maybe'}
            onClick={() => setActiveTab('maybe')}
            className={`py-3 min-h-[44px] rounded-full text-sm font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'maybe'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-gray-700 hover:text-brand-700'
            }`}
          >
            Maybe
            {shortlist.length > 0 && (
              <span className="text-sm font-bold px-2 py-1 rounded-full bg-brand-50 text-brand-700">
                {shortlist.length}
              </span>
            )}
          </button>
        </div>

        {shortlistError && (
          <p className="text-xs text-red-600 text-center">{shortlistError}</p>
        )}

        {activeTab === 'thisWeek' && (
        <>

        {/* End-of-period prompt: shown when the period has ended but the user
            hasn't reviewed it yet. */}
        {planState === 'ended_unfinalized' && (
          <div
            role="region"
            aria-label="End of period review"
            className="bg-brand-50 border border-brand-200 rounded-2xl px-4 py-4 shadow-sm space-y-3"
          >
            <div>
              <p className="section-heading text-brand-700 mb-1">
                Your period has ended
              </p>
              <p className="body-text">
                Mark what you actually cooked, then lock it in.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowReview(true)}
                className="btn-primary"
              >
                Edit what you actually ate
              </button>
              <button
                onClick={handleLockInAsIs}
                disabled={lockingIn}
                className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {lockingIn ? (
                  <><Loader2 size={16} className="animate-spin" /> Finalizing…</>
                ) : (
                  'Lock in as-is'
                )}
              </button>
            </div>
            {periodError && (
              <p className="text-xs text-red-600 text-center">{periodError}</p>
            )}
          </div>
        )}

        {/* Last week's meals */}
        <LastWeekCard items={lastWeek} />

        {/* Date strip + plan */}
        <MealPlanCard
          isServed={isServed}
          selectedDates={selectedDates}
          disabledDates={disabledDates}
          dayGridDates={dayGridDates}
          itemsByDate={itemsByDate}
          plan={plan}
          sensors={sensors}
          onToggleDate={handleToggleDate}
          onRegenerate={() => loadData(true)}
          onDragEnd={handleDragEnd}
          onOpenPicker={handleOpenPicker}
          onToggleCooked={handleToggleCooked}
          onMoveToMaybe={handleMoveToMaybe}
        />

        {/* Serve + Share + Download */}
        <div className="space-y-3">

          {!isServed ? (
            <button
              onClick={handleServe}
              disabled={servingPlan || !canServe}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {servingPlan ? (
                <><Loader2 size={16} className="animate-spin" /> Saving…</>
              ) : (
                <><Check size={16} /> Serve This Plan</>
              )}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 bg-green-50 border border-green-200 rounded-2xl py-3 min-h-[44px]">
              <Check size={16} className="text-green-700" />
              <span className="text-sm font-medium text-green-700">
                Served on {new Date(servedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          )}

          {serveError && (
            <p className="text-xs text-red-600 text-center">{serveError}</p>
          )}

          {isServed && justServed && (
            <button
              onClick={() => { setJustServed(false); setGroceriesOpen(true) }}
              className="btn-primary flex items-center justify-center gap-2"
            >
              <ShoppingCart size={16} />
              Generate grocery list →
            </button>
          )}

          {planState === 'active' && periodError && (
            <p className="text-xs text-red-600 text-center">{periodError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleShare}
              disabled={!isServed || sharing}
              title={!isServed ? 'Finalize plan first' : undefined}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              <Share2 size={16} />
              {sharing ? 'Sharing…' : 'Share plan via text'}
            </button>
            <button
              onClick={() => setGroceriesOpen(true)}
              disabled={!isServed}
              title={!isServed ? 'Finalize plan first' : undefined}
              className="btn-secondary flex-1 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ShoppingCart size={16} />
              Groceries
            </button>
          </div>

          {canResetPlan && (
            <button
              onClick={() => {
                setResetError(null)
                setShowResetConfirm(true)
              }}
              className="w-full flex items-center justify-center gap-2 py-3 min-h-[44px] rounded-2xl border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors text-sm font-semibold"
            >
              <Trash2 size={16} />
              Reset this plan
            </button>
          )}

          {resetError && (
            <p className="text-xs text-red-600 text-center">{resetError}</p>
          )}

        </div>

        </>
        )}

        <MaybeShortlist
          visible={activeTab === 'maybe'}
          items={shortlist}
          isServed={isServed}
          loadedPlan={loadedPlan}
          scheduleSheetItem={scheduleSheetItem}
          onOpenSheet={(item) => setScheduleSheetItem(item)}
          onCloseSheet={() => setScheduleSheetItem(null)}
          onSchedule={handleScheduleFromShortlist}
          onRemove={handleRemoveShortlist}
        />

      </div>

      {/* PRD-002 P0.7: tap-a-day picker. Owns its own data fetch + DB writes;
          the parent only opens (setPickerDate(date)) and refetches on success. */}
      <DayPicker
        date={pickerDate}
        isOpen={!!pickerDate}
        onClose={() => setPickerDate(null)}
        onScheduled={handlePickerScheduled}
        userId={userId}
        planId={loadedPlan?.id ?? null}
        vault={vault}
        recentMeals={storedRecentMeals}
        plan={plan}
        shortlist={shortlist}
        preferences={preferences}
      />

      {/* Reset-plan confirmation sheet. */}
      <Sheet
        isOpen={showResetConfirm}
        onClose={() => !resetting && setShowResetConfirm(false)}
      >
        <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
          <Sheet.Header />
          <Sheet.Content>
            <div className="px-6 py-2 pb-safe">
              <p className="section-heading text-red-700 mb-1">
                Reset this plan?
              </p>
              <p className="text-base font-serif italic text-gray-700 mb-2">
                Clear the current period.
              </p>
              <p className="helper-text mb-6">
                This deletes the dates and every meal in your current plan.
                It can't be undone. Past, finalized periods aren't affected.
              </p>

              {resetError && (
                <p className="text-xs text-red-600 text-center mb-3">
                  {resetError}
                </p>
              )}

              <button
                onClick={handleResetPlan}
                disabled={resetting}
                className="w-full py-3 min-h-[44px] rounded-2xl border border-red-200 bg-red-50 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {resetting ? (
                  <><Loader2 size={16} className="animate-spin" /> Resetting…</>
                ) : (
                  <><Trash2 size={16} /> Reset plan</>
                )}
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                className="btn-secondary mt-2 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </Sheet.Content>
        </Sheet.Container>
        <Sheet.Backdrop onClick={() => !resetting && setShowResetConfirm(false)} />
      </Sheet>

      {/* PRD-002 P1.2: Serve confirmation sheet — feedback before commit. */}
      <Sheet
        isOpen={serveSheetOpen}
        onClose={() => setServeSheetOpen(false)}
      >
        <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
          <Sheet.Header />
          <Sheet.Content>
            <div className="px-6 py-2 pb-safe">
              <p className="section-heading text-brand-700 mb-1">
                Lock in this plan?
              </p>

              <ul className="divide-y divide-gray-100 mb-6 max-h-48 overflow-y-auto">
                {plan.map((slot) => (
                  <li key={slot.id ?? slot.scheduled_date} className="py-2 flex items-baseline justify-between gap-2">
                    <span className="text-base font-serif italic text-gray-900 truncate">
                      {slot.name}
                    </span>
                    <span className="helper-text shrink-0">
                      {slot.scheduled_date}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="space-y-2">
                <button
                  onClick={() => commitServe('positive')}
                  disabled={servingPlan}
                  className="btn-primary flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  <ThumbsUp size={16} />
                  Looks great
                </button>
                <button
                  onClick={() => commitServe('negative')}
                  disabled={servingPlan}
                  className="w-full py-3 min-h-[44px] rounded-2xl border border-gray-200 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <ThumbsDown size={16} />
                  Lock in anyway
                </button>
                <button
                  onClick={() => setServeSheetOpen(false)}
                  disabled={servingPlan}
                  className="btn-secondary disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Pencil size={16} />
                  Let me adjust
                </button>
              </div>
            </div>
          </Sheet.Content>
        </Sheet.Container>
        <Sheet.Backdrop onClick={() => !servingPlan && setServeSheetOpen(false)} />
      </Sheet>

      <GroceryListSheet
        isOpen={groceriesOpen}
        userId={userId}
        onClose={() => setGroceriesOpen(false)}
      />

    </div>
  )
}
