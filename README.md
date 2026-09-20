# Line2Image

A browser-only line-art animation tool.

It starts from a single traveling pen and progressively traces the detected contours until the complete image appears.

## Included default image

The repository contains:

`assets/source.jpg`

That is the image loaded automatically when the site opens.

### Customize the default image

Replace:

`assets/source.jpg`

with your own JPG/PNG image and keep the filename `source.jpg`.

No code change is required.

You can also use **Choose another image** inside the website to test a different image instantly. That upload stays local to your browser and is not sent to a server.

## Run locally

Open `index.html` in a browser.

If your browser blocks local image loading, use a small local server:

```bash
python -m http.server 8000
```

Then open:

`http://localhost:8000`

## GitHub Pages

1. Create a GitHub repository, for example `Line2Image`.
2. Upload all files and folders.
3. Go to **Settings → Pages**.
4. Choose **Deploy from a branch**.
5. Select `main` and `/ (root)`.
6. Save.

## Controls

- Drawing speed — controls how fast the pen travels.
- Line sensitivity — controls which edges are detected.
- Line width — controls the final pen thickness.
- Pen color — changes the line color.
- Choose another image — tests another image without changing the repo.
- Save PNG — saves the current canvas as a PNG.

## Important

This is a client-side raster-to-path effect. It does not require a backend, API key, database, or paid service.

For clean line-art images, use a high-resolution image with a mostly white background and clear dark contours.
