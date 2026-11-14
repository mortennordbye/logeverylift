import { Big_Shoulders, Work_Sans } from "next/font/google";

/**
 * The home's faces (docs/design/home-redesign/home-locked.html): Big Shoulders
 * for the title, the Today name and big numbers; Work Sans for the rest. The
 * home page and its sheets set these variables; the rest of the app keeps
 * Inter. globals.css maps them to `font-display` and `font-ui`.
 */
const display = Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], variable: "--font-big-shoulders" });
const ui = Work_Sans({ subsets: ["latin"], variable: "--font-work-sans" });

/** The class that scopes the home's look: font variables and the token mapping in `.home-ui`. */
export const HOME_UI = `${display.variable} ${ui.variable} home-ui`;
