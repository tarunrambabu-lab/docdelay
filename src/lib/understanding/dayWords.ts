// Weekday names in English, Tamil and Hindi (in English letters).
// SHARED by basic mode (rules.ts reads them to understand "guruvar", "vyazhan" …)
// and by the AI's instructions (aiInstructions.ts shows them next to each
// calendar day), so both always use the same words.
//
// weekday: 0 = Sunday … 6 = Saturday.
// ⚠️ Tamil and Hindi lists to be reviewed by native speakers before real use.

export const WEEKDAYS: { weekday: number; english: string[]; tamil: string[]; hindi: string[] }[] =
  [
    { weekday: 0, english: ["sunday", "sun"], tamil: ["nyayiru", "gnayiru"], hindi: ["ravivar", "itvar"] },
    { weekday: 1, english: ["monday", "mon"], tamil: ["thingal", "thinkal"], hindi: ["somvar"] },
    { weekday: 2, english: ["tuesday", "tue", "tues"], tamil: ["sevvai"], hindi: ["mangalvar"] },
    {
      weekday: 3,
      english: ["wednesday", "wed"],
      tamil: ["budhan", "puthan"],
      hindi: ["budhvar", "budhwar"],
    },
    {
      weekday: 4,
      english: ["thursday", "thu", "thur", "thurs"],
      tamil: ["vyazhan", "viyazhan"],
      hindi: ["guruvar", "veervar", "brihaspativar"],
    },
    { weekday: 5, english: ["friday", "fri"], tamil: ["velli"], hindi: ["shukravar"] },
    { weekday: 6, english: ["saturday", "sat"], tamil: ["sani"], hindi: ["shanivar"] },
  ];
