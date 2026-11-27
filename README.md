# Beam Calculator

A browser-based calculator for **shear force**, **bending moment** and **deflection** diagrams of statically determinate beams. No build step and no dependencies: open `index.html` in a browser.

## Features

- **Supports:** pin + roller at any positions (overhangs allowed), cantilever fixed at the left or right end
- **Loads:** point loads, uniform or linearly varying (triangular/trapezoidal) distributed loads over any part of the span, and applied moments
- **Results:** reactions, max sagging/hogging moment, max shear and max deflection (with span/deflection ratio)
- **Diagrams:** loading and reactions, SFD, BMD and deflected shape, with a linked crosshair that reads values at any x
- Table of values at key points, including exact zero-shear (peak moment) locations
- CSV export, built-in examples, an option to plot the BMD on the tension side, and light and dark themes

## Units and sign convention

| Quantity | Unit |
|---|---|
| Length / position | m |
| Force | kN |
| Distributed load | kN/m |
| Moment | kN·m |
| E | GPa |
| I | ×10⁶ mm⁴ |
| Deflection | mm |

- Point and distributed loads are positive **downward**. Applied moments are positive **clockwise**.
- Shear is positive when the resultant to the left of a section acts upward.
- Bending moment is positive when **sagging**.
- Deflection is positive upward, so gravity loads give negative values.

## How it works

`src/solver.js` finds the reactions from static equilibrium, then evaluates V(x) and M(x) in closed form by summing the actions to the left of each section. It records left and right limits at every load and support position so that jumps are exact. Moment peaks are located by bisecting on V = 0. Deflection comes from numerically integrating M/EI twice and applying the boundary conditions: y = 0 at both supports, or y = θ = 0 at a fixed end.

The solver is plain JavaScript that works in the browser or in Node.

## Tests

```sh
npm test
```

The tests check the solver against textbook results: a simply supported beam with a central point load, a full UDL and a triangular load; cantilevers with a tip load and a UDL; an applied moment; an overhang; and equilibrium checks.
