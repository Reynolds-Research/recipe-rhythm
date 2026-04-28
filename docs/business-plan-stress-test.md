# Recipe-Rhythm — Stress-Tested Business Plan (One-Pager)

**Author's note:** This is a brutally honest one-pager, not a hype document. The goal is to surface the things most likely to make this lose money, set kill criteria *before* you spend, and give you a clear-eyed picture of what "side income" realistically looks like in this market.

**Profile assumed:** solo founder, 10–20 hrs/week, side-income goal (target ~$500–$2,000/mo net), no fixed budget yet.

---

## 1. The Honest Market Reality

Meal planning is one of the **most crowded, most price-anchored** consumer app categories. Here's what users are paying competitors *today*:

| Competitor | Price | Model |
|---|---|---|
| Paprika | $4.99 one-time | Pay once, own forever |
| AnyList | $9.99/year (~$0.83/mo) | Annual subscription |
| Mealime Pro | $5.99/mo or $49.99/yr | Freemium → subscription |
| Plan to Eat | ~$5/mo | Subscription |

**Implication:** The "fair price" anchor in users' minds is closer to $5 *forever* than $5/month. If you launch at $9.99/mo, you'll get sticker-shock churn unless you've earned the premium with a clearly differentiated feature.

## 2. Why This App Could Still Win (the differentiation thesis)

Most meal-planning apps focus on *prospective* planning ("what will you eat next week?"). Recipe-Rhythm's `LogMode` — voice-first retrospective journaling — is genuinely uncommon. The "rhythm" framing (period-based planning + leftovers + review) is also distinctive.

**The wedge:** position Recipe-Rhythm as the meal app for people who already cook from a personal recipe vault and want to *track patterns over time* — not for people looking for AI-generated meal kits. That's a smaller, more loyal audience that's less price-sensitive.

**Risk if wrong:** if "voice logging" turns out to be a feature people *say* they want but don't actually use, you're competing on commodity meal-planning features against entrenched apps. **This is the single biggest assumption to test before spending real money.**

## 3. Unit Economics — Three Pricing Scenarios

All assume Apple's 15% Small Business cut (you qualify), Supabase Pro ($25/mo), Vercel Pro ($20/mo), domain (~$1/mo), Apple Developer ($8/mo amortized). Fixed infra: ~**$54/mo**.

AI cost per *active* user/month (with prompt caching): conservatively **~$0.50** (10 recipe analyses on Sonnet + 20 swap suggestions on Haiku).

| Model | Price | Net per user/mo | Users for $500/mo net | Users for $2,000/mo net |
|---|---|---|---|---|
| Annual sub @ $19.99/yr | ~$1.67/mo | ~$0.92 after cut & AI | **~600** | **~2,200** |
| Monthly sub @ $4.99/mo | $4.99/mo | ~$3.74 after cut & AI | **~150** | **~550** |
| One-time @ $9.99 | (lifetime) | ~$8.49 after cut, then -$0.50/mo AI | Need ~60 new buyers/mo just to cover ongoing AI for 1,000 users | Hard to scale |

**Sanity-check takeaway:** the monthly sub looks best on paper but is hardest to *sell* against $0.83/mo AnyList. The annual sub is more palatable but needs a much larger user base. The one-time model has lowest churn but locks in ongoing AI costs against zero ongoing revenue.

**Recommended starting point:** Annual subscription **$19.99–$29.99/yr** with a free tier for the recipe vault, paywalling AI-suggest, voice logging, and grocery list generation. Test pricing in-app before launch via a landing-page price probe.

## 4. The Distribution Problem (the actually-hard part)

Building the app is the easy 30%. Getting users is the brutal 70%. Honest assessment of channels for a solo founder, 10–20 hrs/week:

- **Paid acquisition (Meta/Google ads):** Almost certainly negative ROI at these price points. CAC for consumer mobile apps typically runs $30–$150; LTV at $19.99/yr × 2-yr retention is ~$25 net. **Don't spend here until LTV is proven.**
- **App Store Optimization (ASO):** Slow but free. Requires good screenshots, keywords, reviews. Worth doing, won't drive launch volume.
- **Content/SEO (recipe-adjacent blog or YouTube):** Highest ceiling for a side project, but a 6–12 month time investment.
- **TikTok / Instagram Reels:** Best fit for the "voice logging your meals" angle — it's visual and a little novel. Realistic if you (or someone in the household) is willing to be on camera.
- **Reddit / niche communities:** r/MealPrepSunday, r/EatCheapAndHealthy, etc. Low volume but high-intent.
- **Personal network / waitlist:** Always start here. 50 people who genuinely want it > 5,000 cold installs.

**The honest answer:** without an existing audience or willingness to do content, this is very hard. **Decide your distribution path before writing more product code.**

## 5. Recommended Budget (since you haven't set one)

Given side-income goals and a 10–20 hr/week pace, propose this tiered budget:

- **Validation phase (months 0–3): ~$300 total.** Apple Developer ($99), domain ($15), landing page tools ($0–50), prompt-caching enabled to keep AI costs near zero pre-launch. Do not spend on ads.
- **Soft launch (months 3–6): ~$500–$800.** Supabase Pro ($25/mo), Vercel Pro ($20/mo), maybe a designer for icon + screenshots ($200 one-time), small ASO tool subscription. Still no paid ads.
- **Growth test (months 6–9, only if you have ≥100 paying users): ~$500–$1,500.** First small paid-acquisition tests. **If CAC > 1-yr LTV, stop.**

**Total at-risk capital before kill decision: ~$1,500–$2,500.** That's the number you should be willing to lose entirely. If you're not, don't start.

## 6. Pre-Mortem: How This Most Likely Dies

Ranked by likelihood, with mitigations:

1. **No one finds it.** (Most likely failure mode.) → Mitigation: pick distribution channel *before* building more, validate willingness-to-pay with a landing page first.
2. **People install but don't convert to paid.** → Mitigation: paywall the right feature (AI/voice/grocery) and make the free tier genuinely useful but obviously limited.
3. **AI costs balloon faster than revenue.** → Mitigation: prompt caching from day one; rate-limit free tier; monitor cost-per-active-user weekly.
4. **You burn out before traction.** (Real risk on a 10–20 hr/wk side project competing in a crowded space.) → Mitigation: time-box; honor kill criteria.
5. **A big player (Apple, Google, Samsung/Whisk) ships an integrated competitor.** → Mitigation: not preventable. Stay nimble; the household-size niche may be too small to interest them.

## 7. Kill Criteria (write these down BEFORE launching)

Pull the plug — or pivot — if any of these hit. Set them now while you can think clearly.

- **Month 3 post-launch:** fewer than **25 paying users** *or* free→paid conversion under **2%**.
- **Month 6:** fewer than **100 paying users** *or* monthly active users falling month-over-month for 2 straight months.
- **Anytime:** AI cost per paying user > **30% of revenue per user** for two consecutive months.
- **Anytime:** total cash spent > **$2,500** without break-even in sight.
- **Anytime:** you've gone 4+ weeks without shipping anything because you don't want to. (That's the burnout signal.)

## 8. The Three Things to Do Before Writing Another Line of Code

1. **Build a landing page** with a clear value prop, a $19.99/yr "early-access" price, and an email signup. Drive 200–500 visits via free channels (Reddit, your network, a TikTok or two). Measure: signup rate, willingness-to-pay clicks. **If nobody signs up, the app won't sell either.**
2. **Talk to 10 real potential users** (not friends being polite). Specifically test the LogMode voice-journaling wedge. Would they pay for *that*?
3. **Pick one distribution channel** and commit to it for 90 days. If you can't pick one you'd actually do, this is a red flag worth taking seriously.

---

**Bottom line:** this is a viable side project, but only if (a) the voice-logging differentiation holds up under user testing, (b) you commit to one distribution channel you'll actually execute, and (c) you respect the kill criteria. The market is too crowded and price-anchored to muscle through with a generic meal planner — but a sharply positioned one for people who already keep a recipe vault has a real shot at $500–$2,000/mo net within 12–18 months. Don't spend on ads until LTV is proven.

---

*Sources for cost/pricing assumptions:*
- *Apple App Store Small Business Program — 15% commission for revenue under $1M/yr ([Apple Developer](https://developer.apple.com/app-store/small-business-program/))*
- *Anthropic API pricing — Sonnet 4.6 $3/$15 per M tokens, Haiku 4.5 $1/$5 ([Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing))*
- *Competitor pricing — Paprika $4.99 one-time ([paprikaapp.com](https://www.paprikaapp.com/)); AnyList $9.99/yr, Mealime $5.99/mo ([The Kitchn meal-planning apps roundup](https://www.thekitchn.com/best-meal-planning-apps-264934))*
