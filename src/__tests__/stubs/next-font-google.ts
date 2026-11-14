/**
 * next/font/google for Vitest: the real loader only runs inside Next's
 * compiler. Each face gives empty class names, which is all a test sees.
 */
const face = () => ({ className: "", variable: "", style: { fontFamily: "" } });
export const Big_Shoulders = face;
export const Work_Sans = face;
