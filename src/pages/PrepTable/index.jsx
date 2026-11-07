import { useMemo, useState } from 'react'
import { DndContext } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Loader2, Sparkles, Bookmark, X, CalendarPlus, User } from 'lucide-react'
import Logo from '../../components/Logo'
import { usePrepTable } from './usePrepTable'
import DayButtons from './DayButtons'
import DayRow from './DayRow'
import { dateLabel, weekTitle } from './labels'
import AddMealSheet from './AddMealSheet'
import DayChoiceSheet from './DayChoiceSheet'
import WeekConfirm, { ChangedBanner } from './WeekConfirm'
import GrocerySheet from './GrocerySheet'
import { dayUnderPointer, dragAnnouncements, resolveDrop, usePrepTableSensors } from './dragDrop'

/**
 * The Prep Table (PRD-008 P0.4, phase 2b-2; the only one since the period
 * screens were retired in phase 4). Meals sit on dates; nothing locks. "Confirm the week" stamps the
 * week and makes its grocery list (2b-3). Phase 3: a day can be handed to the
 * other person ("Matt's night"); on their phone it reads "Your night · Pick
 * something", with one suggestion ready.
 */

/** "Tue" / "Tue and Thu" / "Mon, Tue and Thu". */
function weekdays(dates) {
  const names = dates.map((d) => dateLabel(d).weekday)
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
/** "Nov 1 – 7 · 5 dinners" under the grocery sheet's title. */
function groceriesSubtitle(pt) {
  const n = pt.mealCount ?? 0
  return `${weekTitle(pt.weekStart, pt.weekEnd)} · ${n} ${n === 1 ? 'dinner' : 'dinners'}`
}

export default function PrepTable({ userId, today }) {
  const pt = usePrepTable(userId, today ? { today } : undefined)
  const [tab, setTab] = useState('week')
  const [addTarget, setAddTarget] = useState(null)   // date | 'maybe' | null
  const [choosing, setChoosing] = useState(null)     // { meal, kind: 'move' | 'replan' | 'fromMaybe' }
  const [trayOpen, setTrayOpen] = useState(true)
  const sensors = usePrepTableSensors()
  const mealsById = useMemo(() => {
    const by = {}
    for (const list of Object.values(pt.mealsByDate)) for (const m of list) by[m.id] = m
    return by
  }, [pt.mealsByDate])

  const isThisWeek = pt.dayArgs.weekStart <= pt.today && pt.today <= pt.weekEnd

  const onChoose = (date) => {
    const { meal, kind } = choosing
    setChoosing(null)
    if (kind === 'replan') pt.replan(meal, date)
    else pt.moveTo(meal, date)
  }

  return (
    <div className="mobile-screen pb-28">
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-600 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">Plan the week</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div role="tablist" aria-label="Plan view" className="grid grid-cols-2 gap-1 bg-cream-100 rounded-full p-1">
          {[['week', 'Week'], ['maybe', 'Maybe']].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`py-3 min-h-[44px] rounded-full text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 ${
                tab === id ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-700 hover:text-brand-600'}`}>
              {label}
              {id === 'maybe' && pt.maybe.length > 0 && (
                <span className="text-sm font-bold px-2 py-1 rounded-full bg-brand-50 text-brand-600">{pt.maybe.length}</span>
              )}
            </button>
          ))}
        </div>

        {pt.error && (
          <div role="alert" className="flex items-start gap-2 rounded-2xl bg-red-50 border border-red-200 px-4 py-3">
            <p className="flex-1 text-sm text-red-800">{pt.error}</p>
            <button type="button" onClick={pt.clearError} aria-label="Dismiss" className="w-11 h-11 -m-3 flex items-center justify-center text-red-800"><X size={16} /></button>
          </div>
        )}

        {tab === 'week' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="btn-icon disabled:opacity-50" aria-label="Previous week" disabled={pt.busy} onClick={() => pt.goWeek(-1)}>
                <ChevronLeft size={20} />
              </button>
              <div className="text-center">
                <p className="font-bold text-gray-900" data-testid="week-title">{weekTitle(pt.dayArgs.weekStart, pt.weekEnd)}</p>
                {!isThisWeek && (
                  <button type="button" onClick={pt.goThisWeek} disabled={pt.busy} className="text-sm font-semibold text-brand-600 min-h-[44px] px-3">
                    Back to this week
                  </button>
                )}
              </div>
              <button type="button" className="btn-icon disabled:opacity-50" aria-label="Next week" disabled={pt.busy} onClick={() => pt.goWeek(1)}>
                <ChevronRight size={20} />
              </button>
            </div>

            {pt.loading ? (
              <div className="flex justify-center py-10" role="status" aria-label="Loading the week">
                <Loader2 className="animate-spin text-brand-600" />
              </div>
            ) : (
              <>
                {pt.toPick.length > 0 && (
                  <section aria-label="Your nights to pick" className="card p-3 flex items-center gap-3">
                    <User size={18} className="text-brand-600 shrink-0" aria-hidden="true" />
                    <p className="text-sm text-gray-900">
                      <strong>{pt.toPick.length} {pt.toPick.length === 1 ? 'night' : 'nights'} to pick</strong> this week: {weekdays(pt.toPick)}.
                    </p>
                  </section>
                )}

                {pt.changedSinceConfirmed && !pt.making && (
                  <ChangedBanner busy={pt.busy} onUpdate={pt.updateList} onKeep={pt.keepAsIs} />
                )}

                <DayButtons dayArgs={pt.dayArgs} onToggle={pt.toggleDay} disabled={pt.busy} />

                {pt.canSuggest && (
                  <button type="button" onClick={pt.suggestEmptyDays} disabled={pt.busy}
                    className="btn-secondary py-3 flex items-center justify-center gap-2">
                    <Sparkles size={18} /> Suggest the empty days
                  </button>
                )}

                {pt.dates.length === 0 && (
                  <p className="helper-text text-center py-6">No days showing this week. Tap a day above to add it.</p>
                )}

                <DndContext
                  sensors={sensors}
                  collisionDetection={dayUnderPointer}
                  accessibility={{
                    announcements: dragAnnouncements(
                      (id) => mealsById[id]?.name,
                      (d) => `${dateLabel(d).weekday} ${dateLabel(d).monthDay}`,
                      (id) => mealsById[id]?.planned_on,
                      (d) => (pt.mealsByDate[d]?.length === 1 ? pt.mealsByDate[d][0].id : null),
                    ),
                  }}
                  onDragEnd={(event) => {
                    const drop = resolveDrop(event, mealsById, pt.mealsByDate)
                    if (drop) pt.dropOnDay(drop.mealId, drop.toDate, drop.swapWithId)
                  }}
                >
                <div className="space-y-3">
                  {pt.dates.map((date) => (
                    <DayRow
                      key={date}
                      date={date}
                      today={pt.today}
                      meals={pt.mealsByDate[date]}
                      proposal={pt.proposals[date]}
                      canSuggest={pt.vault.length > 0}
                      busy={pt.busy}
                      onAdd={() => setAddTarget(date)}
                      onSuggest={() => pt.suggestDay(date)}
                      onAccept={() => pt.acceptProposal(date)}
                      onDismiss={() => pt.dismissProposal(date)}
                      onToggleCooked={pt.toggleCooked}
                      onMove={(meal) => setChoosing({ meal, kind: 'move' })}
                      onRemove={pt.remove}
                      nightLabel={pt.nightLabelOn(date)}
                      giveLabel={pt.giveLabel}
                      onToggleNight={() => pt.toggleNight(date)}
                      pickedBy={pt.pickedBy}
                    />
                  ))}
                </div>
                </DndContext>

                <WeekConfirm
                  key={pt.dayArgs.weekStart}
                  confirmation={pt.confirmation}
                  canConfirm={pt.canConfirm}
                  emptyDays={pt.emptyDays}
                  emptyDetails={pt.emptyDetails}
                  busy={pt.busy}
                  making={pt.making}
                  notice={pt.notice}
                  onConfirm={pt.confirm}
                  onMakeList={pt.updateList}
                  onOpenList={pt.openGroceries}
                />

                {pt.tray.length > 0 && (
                  <section aria-label="Didn't get to these" className="rounded-2xl border border-cream-200 bg-cream-100/50 p-4 space-y-2">
                    <button type="button" onClick={() => setTrayOpen((o) => !o)} aria-expanded={trayOpen}
                      className="w-full flex items-center justify-between min-h-[44px]">
                      <span className="section-heading">Didn’t get to these</span>
                      <span className="text-sm font-bold text-gray-700">{pt.tray.length}</span>
                    </button>
                    {trayOpen && (
                      <ul className="space-y-2">
                        {pt.tray.map((meal) => (
                          <li key={meal.id}>
                            <button type="button" onClick={() => setChoosing({ meal, kind: 'replan' })} disabled={pt.busy}
                              className="w-full text-left card p-3 min-h-[48px] flex items-center gap-2">
                              <CalendarPlus size={16} className="text-brand-600 shrink-0" aria-hidden="true" />
                              <span className="flex-1 font-medium text-gray-900">{meal.name}</span>
                              <span className="text-xs text-gray-700">{dateLabel(meal.planned_on).weekday} {dateLabel(meal.planned_on).monthDay}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}

        {tab === 'maybe' && (
          <section aria-label="Maybe list" className="space-y-3">
            <p className="helper-text">Ideas with no day yet. Tap one to put it on a day.</p>
            {pt.maybe.length === 0 && <p className="helper-text text-center py-4">Nothing here yet.</p>}
            <ul className="space-y-2">
              {pt.maybe.map((meal) => (
                <li key={meal.id} className="card p-3 flex items-center gap-2 min-h-[48px]">
                  <Bookmark size={16} className="text-brand-600 shrink-0" aria-hidden="true" />
                  <button type="button" onClick={() => setChoosing({ meal, kind: 'fromMaybe' })} disabled={pt.busy}
                    className="flex-1 text-left font-medium text-gray-900 min-h-[44px]">
                    {meal.name}
                  </button>
                  <button type="button" onClick={() => pt.remove(meal)} disabled={pt.busy} aria-label={`Remove ${meal.name}`}
                    className="w-11 h-11 flex items-center justify-center text-gray-700 hover:text-red-700">
                    <X size={18} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setAddTarget('maybe')} className="btn-secondary py-3">+ Add to Maybe</button>
          </section>
        )}
      </div>

      <AddMealSheet
        target={addTarget}
        vault={pt.vault}
        maybe={pt.maybe}
        onClose={() => setAddTarget(null)}
        onPickRecipe={(recipe) => {
          const t = addTarget; setAddTarget(null)
          if (t === 'maybe') pt.addToMaybe({ name: recipe.name, vaultId: recipe.id })
          else pt.addToDay(t, { name: recipe.name, vaultId: recipe.id })
        }}
        onAddAsIs={(name) => {
          const t = addTarget; setAddTarget(null)
          if (t === 'maybe') pt.addToMaybe({ name })
          else pt.addToDay(t, { name })
        }}
        onPickMaybe={(meal) => {
          const t = addTarget; setAddTarget(null)
          pt.moveTo(meal, t)
        }}
      />

      <GrocerySheet
        open={pt.groceries.open}
        loading={pt.groceries.loading}
        failed={pt.groceries.failed}
        items={pt.groceries.items}
        staples={pt.groceries.staples}
        subtitle={pt.groceries.open ? groceriesSubtitle(pt) : null}
        leftOff={pt.leftOff}
        guessed={pt.guessed}
        updating={pt.making}
        onUpdateList={pt.updateList}
        onSetAssumed={pt.setItemAssumed}
        onSetAlwaysHave={pt.setAlwaysHave}
        onAddOwn={pt.addOwnItem}
        onRemoveOwn={pt.removeOwnItem}
        onClose={pt.closeGroceries}
      />

      <DayChoiceSheet
        meal={choosing?.meal ?? null}
        dates={pt.dates}
        today={pt.today}
        allowMaybe={choosing?.kind === 'move'}
        onChoose={onChoose}
        onClose={() => setChoosing(null)}
      />
    </div>
  )
}
