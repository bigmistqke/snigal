# snigal

Interpretation of modderme's [`reactively`](https://github.com/modderme123/reactively) aka [`solid 2.0`](https://github.com/solidjs/signals): A lazy push-pull reactive signal implementation.

> This repo exists for educational purposes. The code is not tuned for performance, but is instead kept simple for readability sake. The codebase is not based directly on any of the repos linked above, but is an interpretation of the [following article](https://dev.to/modderme123/super-charging-fine-grained-reactive-performance-47ph) by modderme.

## Quick start

<!-- Install it:

```bash
npm i @bigmistqke/snigal
# or
yarn add @bigmistqke/snigal
# or
pnpm add @bigmistqke/snigal
``` -->

Use it:

```tsx
import { Snigal, Computed, Effect } from 'snigal'

const snigal1 = new Snigal(0)
const snigal2 = new Snigal(0)
const computed = new Computed(() => signal1.get() + signal2.get())
new Effect(() => console.log(computed.get()))
```
