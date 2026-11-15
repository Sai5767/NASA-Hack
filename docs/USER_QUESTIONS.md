# Questions every user should be asked

The To Do asked for a list of everything a user needs to be asked. This is that list, how each question is asked in the app,
and what the answer changes. Five are asked in the **Personalise** wizard (`frontend/src/components/Intake.jsx`); the rest are
asked implicitly by the main screen. Answers are stored only in the browser (`localStorage`: `td-profile`, `td-watch`,
`td-view`) and never sent to the server.

## Asked in the wizard (home screen, "Personalise")

| # | Question | Options | What the answer changes |
| - | --- | --- | --- |
| 1 | **Who is investigating?** | Just curious, A student, A teacher or communicator, A scientist or analyst | Sets a sensible default for question 4 (curious: plain words; analyst: numbers). |
| 2 | **What are you curious about?** (any number) | Heat, Rain and drought, Sunlight and clouds, Wind, Humidity, Soil and water, Ice and the poles | Chooses the variables and the guided cases shown in the **For you** pop-ups and the starter watchlist. |
| 3 | **Which places matter to you?** (any number) | Frozen north, Rainforest, Desert, Big farmland, Megacity region, High mountains, Open ocean | Crossed with question 2 to make personal suggestions ("Heat near Delhi") and to seed the watchlist. |
| 4 | **How technical should we be?** | Plain words, A bit of both, Show me the numbers | Case files open on the **Overview** (plain, balanced) or straight on the **Detail** view (numbers). Can be changed any time with the Overview/Detail switch. |
| 5 | **What would you like to do first?** | Explore near me, Check a claim, Compare two places, See what might come next, Learn how the evidence works | Does it: opens the first suggestion, focuses the question box, opens the Duel, opens the forecast lab, or opens the glossary. |

## Asked by the main screen, not the wizard

| Question | How it is asked | Notes |
| --- | --- | --- |
| **Which place?** | Click the globe, type a place or a question ("is Phoenix getting hotter?"), pick a quick place, or enter coordinates | The challenge's "where". |
| **Which variable?** | Dropdown of 19 variables in 5 groups, the question box, or the sweep that ranks all of them | The challenge's "what". |
| **Which years?** | From and to year, default 1981 to the last complete year, at least 20 years | Shorter records cannot support a trend. |
| **How big a region?** | Scan grid size and points per side | Only when scanning. |
| **Compare with where?** | Second pin in the Duel | Only when comparing. |
| **Do you want to keep this?** | Star button ("Watch") on a case file | Adds the place and variable to the home watchlist. |

## What we deliberately do not ask

Name, email, age, exact location, account or sign-in. Nothing needs them, and the wizard stores nothing off the device.

## Questions worth adding later

- Preferred units (Celsius or Fahrenheit, millimetres or inches).
- Language (the app is English only; the competition asks for English subtitles on the video).
- Accessibility needs beyond the reduced-motion setting the browser already reports (larger text, high contrast).
- A "what changed since my last visit" prompt for returning users.
