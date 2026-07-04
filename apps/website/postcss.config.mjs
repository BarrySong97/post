/**
 * @purpose Wire Tailwind CSS v4 into the Next.js PostCSS pipeline.
 * @role    PostCSS config for the website app.
 * @deps    @tailwindcss/postcss.
 * @gotcha  Tailwind v4 uses the @tailwindcss/postcss plugin, not the legacy tailwindcss plugin.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
