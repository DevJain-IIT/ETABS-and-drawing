import type { Config } from "tailwindcss";

// Design tokens lifted verbatim from Design/dbr/shared.jsx (the T object +
// verdict semantics) so the Next port reads identically to the mockups and to
// the sibling "Claused" product.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // dark (landing / marketing)
        navy: "#0A1628",
        surface: "#14233D",
        borderD: "#1F3A5F",
        textD: "#F1F5F9",
        mutedD: "#94A3B8",
        // light (app)
        paper: "#FAF7F2",
        panel: "#FFFFFF",
        sand: "#F4EFE4",
        border: "#E8E4DC",
        ink: "#0A1628",
        muted: "#6B6860",
        subtle: "#94908A",
        // accents
        cyan: "#22D3EE",
        cyanDeep: "#0E7490",
        indigo: "#6366F1",
        // verdict solids (color always paired with icon+label in components)
        verdict: {
          pass: "#0E9F6E",
          flaw: "#E11D48",
          review: "#E08A00",
          missing: "#5B7A99",
          na: "#A8A29E",
        },
      },
      fontFamily: {
        serif: ['"Playfair Display"', "Georgia", "serif"],
        sans: ["Inter", "-apple-system", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(.34,1.56,.64,1)",
      },
      maxWidth: {
        report: "1080px",
        landing: "1180px",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "badge-pop": {
          "0%": { opacity: "0", transform: "scale(.6)" },
          "60%": { transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(.92) translateY(8px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        spin: { to: { transform: "rotate(360deg)" } },
        pulse2: { "0%": { transform: "scale(1)", opacity: ".5" }, "100%": { transform: "scale(2.6)", opacity: "0" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-5px)" } },
        drawer: {
          from: { opacity: "0", transform: "translateY(-6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up .5s both",
        "fade-in": "fade-in .35s both",
        "badge-pop": "badge-pop .42s cubic-bezier(.34,1.56,.64,1) both",
        "pop-in": "pop-in .4s cubic-bezier(.34,1.56,.64,1) both",
        spin: "spin .9s linear infinite",
        pulse2: "pulse2 2s ease-out infinite",
        float: "float 4s ease-in-out infinite",
        drawer: "drawer .3s cubic-bezier(.34,1.56,.64,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
