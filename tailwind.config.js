/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(222 20% 8%)",
        panel: "hsl(222 18% 12%)",
        border: "hsl(222 14% 22%)",
        accent: "hsl(38 92% 55%)",
      },
    },
  },
  plugins: [],
};
