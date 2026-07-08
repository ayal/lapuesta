# la puesta

An endless sunset on a tiny planet.

A miniature world of islands, mountain ranges and shallow seas. A sun
circles the planet — on a differently tilted orbit every day — so
somewhere on the horizon it is always setting, and always rising. Each
"day" brings a new sunset palette: oranges, deep reds, magentas, roses.
Volumetric clouds drift on the wind, terminator clouds catch fire, and
the sun pours a molten glint across the water.

**Drag** to wander around the planet (the top of the world stays
centered). **Scroll / pinch** to zoom. Stay still for a few seconds and
the auto tour takes over again.

## Tech

- [Three.js](https://threejs.org/) + TypeScript + Vite
- Terrain: noise-displaced icosphere with triplanar-mapped CC0 textures
  (grass / rock / sand / snow blended by altitude and slope) plus
  per-fragment bump detail re-evaluated in the shader
- Water: animated normal ripples, depth-based color, shore foam, sunset
  specular
- Clouds: true volumetric raymarching of a 3D fbm density texture, with
  light-marched self-shadowing, forward-scattering silver linings and
  noise-eroded feathery edges
- Lighting: no scene lights — everything shades itself against a shared
  sun direction and a palette-driven "dusk ramp" (sky color as a function
  of sun elevation), so terrain, water, clouds and atmosphere always agree
- Bloom + vignette postprocessing

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # static build in dist/
```

Pushes to `main` deploy to GitHub Pages via Actions.

## Credits

Techniques studied from
[flo-bit/tiny-planets](https://github.com/flo-bit/tiny-planets),
[troisjs/little-planet](https://github.com/troisjs/little-planet),
[bobbyroe/threejs-earth](https://github.com/bobbyroe/threejs-earth),
[dgreenheck/threejs-procedural-planets](https://github.com/dgreenheck/threejs-procedural-planets)
and the official three.js
[volume cloud example](https://threejs.org/examples/?q=cloud#webgl_volume_cloud).
Terrain textures are CC0 from [Poly Haven](https://polyhaven.com/).
