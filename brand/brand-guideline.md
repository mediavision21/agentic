# Mediavision Brand Guidelines — Web Implementation

## Fonts

### Import (Google Fonts)
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gelasio:wght@500&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
```

### CSS
```css
--font-headline: 'Gelasio', Georgia, serif;   /* headlines only */
--font-body:     'Inter', Arial, sans-serif;  /* UI, body, buttons */
```

| Role    | Font           | Weight | Size | Letter-spacing |
| ------- | -------------- | ------ | ---- | -------------- |
| H1      | Gelasio        | 500    | 60px | -2px           |
| H2      | Gelasio        | 500    | 48px | -1px           |
| Ingress | Inter          | 400    | 30px | 0              |
| Body    | Inter          | 400    | 16px | 0              |
| Button  | Inter          | 500    | 16px | uppercase      |

---

## Color Palette

```css
:root {
    /* Primary */
    --color-forest:       #1C5F4A; /* signature — always most prominent */
    --color-dusk:         #0A3B55; /* complementary dark blue */
    --color-black:        #000000;
    --color-white:        #FFFFFF;

    /* Grays */
    --color-gray-dark:    #272625;
    --color-gray-mid:     #5B5A56;
    --color-gray-light:   #C2C1BF;
    --color-gray-lighter: #E6E6E1;

    /* Green scale */
    --color-green-900:    #0D3326;
    --color-green-700:    #1C5F4A; /* = forest */
    --color-green-500:    #2E8C6E;
    --color-green-300:    #7BBFAA;
    --color-green-100:    #D4EDE6;

    /* Blue scale */
    --color-blue-900:     #051F2E;
    --color-blue-700:     #0A3B55; /* = dusk */
    --color-blue-500:     #155F88;
    --color-blue-300:     #6AAABF;
    --color-blue-100:     #D0E8F0;

    /* Red scale */
    --color-red-900:      #5C0F0F;
    --color-red-700:      #9B1B1B;
    --color-red-500:      #C93333;
    --color-red-300:      #E08080;
    --color-red-100:      #F5D5D5;

    /* Yellow scale */
    --color-yellow-900:   #5C3D00;
    --color-yellow-700:   #996600;
    --color-yellow-500:   #CC9900;
    --color-yellow-300:   #E6C060;
    --color-yellow-100:   #F7ECC0;

    /* Purple scale */
    --color-purple-900:   #2B0A3D;
    --color-purple-700:   #511A72;
    --color-purple-500:   #7D35A8;
    --color-purple-300:   #B080D0;
    --color-purple-100:   #E5D0F5;

    /* Gray scale */
    --color-gray-900:     #1A1918;
    --color-gray-700:     #272625; /* = gray-dark */
    --color-gray-500:     #5B5A56; /* = gray-mid */
    --color-gray-300:     #C2C1BF; /* = gray-light */
    --color-gray-100:     #E6E6E1; /* = gray-lighter */
}
```

---

## Logo Usage

- Use only **black** or **white** versions — never color, gradients, or custom tints
- **White logo** on dark backgrounds; **black logo** on light backgrounds
- Prefer **SVG** format for web (sharp at all sizes)
- Never stretch, rotate, redraw, or add effects to the logo

---

## Color Rules

- **Forest Green** (`--color-forest`) must always be the dominant brand color
- No gradients
- No transparency / opacity adjustments to brand colors
- Avoid low-contrast color pairings
- Never communicate information through color alone — always pair with shape, label, or icon (accessibility)

---

## Typography Rules

- Don't stretch or distort fonts
- Don't add outlines or shadows
- Don't over-tighten letter-spacing beyond spec
- Don't reduce line-height below readable levels
- Don't justify text alignment
- Only use Gelasio and Inter — no substitutions

---

## Image Style

- Nordic landscapes, nature, light environments
- Abstract graphic blur effects as accents
- Light, natural, minimal — avoid busy or dark imagery
