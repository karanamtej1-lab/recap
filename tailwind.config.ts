import path from "node:path";
import type { Config } from "tailwindcss";

// Absolute globs: Tailwind resolves relative ones from the shell's cwd, not this file.
const here = (glob: string) => path.join(__dirname, glob);

const config: Config = {
  content: [here("app/**/*.{ts,tsx}"), here("components/**/*.{ts,tsx}")],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0b0c10", 900: "#111318", 800: "#181b22", 700: "#232731", 600: "#323846" },
        accent: { DEFAULT: "#7c6cff", soft: "#a99fff" },
        hot: "#ff6b8b",
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"], mono: ["var(--font-mono)", "monospace"] },
    },
  },
  plugins: [],
};
export default config;
