import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        elevated: "hsl(var(--elevated))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(0 0% 100%)" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(0 0% 100%)" },
        neutral: { DEFAULT: "hsl(var(--neutral))", foreground: "hsl(0 0% 100%)" },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        // Barra de progresso indeterminada (estilo YouTube/Linear): faixa que
        // desliza horizontalmente em loop infinito, larga ~40%.
        "nx-indeterminate": {
          "0%":   { transform: "translateX(-100%) scaleX(0.4)" },
          "50%":  { transform: "translateX(20%) scaleX(0.6)" },
          "100%": { transform: "translateX(140%) scaleX(0.4)" },
        },
        // Pulse sutil para o logo no splash
        "nx-logo-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%":      { opacity: "0.75", transform: "scale(0.96)" },
        },
        "nx-fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "nx-heartbeat": {
          "0%, 100%": {
            transform: "scale(1)",
            boxShadow: "0 0 0 0 hsl(var(--primary) / 0), 0 0 0 0 hsl(var(--primary) / 0)",
          },
          "50%": {
            transform: "scale(1.012)",
            boxShadow: "0 0 0 6px hsl(var(--primary) / 0.10), 0 0 48px 4px hsl(var(--primary) / 0.28)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "nx-indeterminate": "nx-indeterminate 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "nx-logo-pulse": "nx-logo-pulse 1.6s ease-in-out infinite",
        "nx-fade-in": "nx-fade-in 0.25s ease-out",
        "nx-heartbeat": "nx-heartbeat 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
