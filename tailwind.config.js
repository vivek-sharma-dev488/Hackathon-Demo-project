/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#f7f5ef",
        ink: "#172126",
        coral: "#f2643d",
        moss: "#2e5e4e",
        amber: "#e1a42a"
      }
    }
  },
  plugins: []
};
