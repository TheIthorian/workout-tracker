# Third-party notices

## Body diagram geometry

The muscle map in `apps/web` (`apps/web/src/components/muscles/body-paths.ts`) is drawn from
[**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih Colpan, used under the MIT
licence reproduced below.

MuscleMap ships its path data as Swift source rather than `.svg` files. The male front and back
tables were converted to a TypeScript module by `scripts/generate-body-paths.mjs`, which drops the
sub-group shapes (upper-abs, lower-chest, outer-quad, front-deltoid and the rest) because nothing
in this app resolves to a sub-region. Nothing else about the artwork was changed.

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
