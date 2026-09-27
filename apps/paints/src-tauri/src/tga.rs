//! Showing the paint itself.
//!
//! The cards preview whatever the design pipeline exported as PNG, but a version need not have
//! one, and a render is not the file that gets installed. This decodes the `.tga` so the app can
//! show the actual artwork — flat, in UV space, but unarguably the bytes going into the sim.
//!
//! iRacing's own paints are uncompressed 24-bit, but a paint folder collects files from
//! everywhere, so run-length encoding, 16- and 32-bit colour and greyscale are all handled.
//! Colour-mapped TGAs are refused by name rather than rendered as noise.
//!
//! Decoding 2048x2048 and shipping it to a 280-pixel card would waste most of the work, so the
//! result is downscaled and cached as PNG against the file's size and modification time.

use crate::error::{AppError, Result};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

/// A paint is 12MB; something an order of magnitude larger is not a car texture.
const MAX_SOURCE_BYTES: u64 = 192 * 1024 * 1024;
/// Beyond this a TGA is not plausible and the allocation should not be attempted.
const MAX_PIXELS: u64 = 16_384 * 16_384;
/// Keep the cache bounded — a big library could otherwise hold every paint in memory.
const MAX_CACHE_ENTRIES: usize = 48;

pub struct Image {
    pub width: u32,
    pub height: u32,
    /// Tightly packed RGB, top row first.
    pub rgb: Vec<u8>,
}

// Written out rather than derived: a derived Debug would print every pixel, so one stray
// `{:?}` in a test failure would spew twelve megabytes.
impl std::fmt::Debug for Image {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Image {}x{} ({} bytes)",
            self.width,
            self.height,
            self.rgb.len()
        )
    }
}

struct Header {
    id_len: usize,
    color_map_type: u8,
    image_type: u8,
    color_map_len: usize,
    color_map_entry_bits: u8,
    width: u32,
    height: u32,
    bits: u8,
    descriptor: u8,
}

fn read_header(b: &[u8]) -> Result<Header> {
    if b.len() < 18 {
        return Err(AppError::other("Not a TGA: the file is too short."));
    }
    Ok(Header {
        id_len: b[0] as usize,
        color_map_type: b[1],
        image_type: b[2],
        color_map_len: u16::from_le_bytes([b[5], b[6]]) as usize,
        color_map_entry_bits: b[7],
        width: u16::from_le_bytes([b[12], b[13]]) as u32,
        height: u16::from_le_bytes([b[14], b[15]]) as u32,
        bits: b[16],
        descriptor: b[17],
    })
}

/// Turn one source pixel into RGB. TGA stores colour as BGR(A).
fn pixel_to_rgb(px: &[u8], bits: u8, out: &mut [u8]) {
    match bits {
        32 | 24 => {
            out[0] = px[2];
            out[1] = px[1];
            out[2] = px[0];
        }
        16 => {
            // ARRRRRGG GGGBBBBB, five bits a channel, widened so white stays white.
            let v = u16::from_le_bytes([px[0], px[1]]);
            let r = ((v >> 10) & 0x1f) as u8;
            let g = ((v >> 5) & 0x1f) as u8;
            let b = (v & 0x1f) as u8;
            out[0] = (r << 3) | (r >> 2);
            out[1] = (g << 3) | (g >> 2);
            out[2] = (b << 3) | (b >> 2);
        }
        // Greyscale.
        _ => {
            out[0] = px[0];
            out[1] = px[0];
            out[2] = px[0];
        }
    }
}

/// Decode a TGA into packed RGB, top row first.
pub fn decode(bytes: &[u8]) -> Result<Image> {
    let h = read_header(bytes)?;

    if h.color_map_type != 0 || h.image_type == 1 || h.image_type == 9 {
        return Err(AppError::other(
            "This TGA uses a colour map, which iRacing paints do not. Re-export it as 24- or \
             32-bit true colour.",
        ));
    }
    let rle = match h.image_type {
        2 | 3 => false,
        10 | 11 => true,
        0 => return Err(AppError::other("This TGA holds no image data.")),
        other => {
            return Err(AppError::other(format!(
                "Unsupported TGA image type {other}."
            )))
        }
    };
    let bytes_per_px = match h.bits {
        32 => 4,
        24 => 3,
        16 => 2,
        8 => 1,
        other => {
            return Err(AppError::other(format!(
                "Unsupported TGA colour depth: {other} bits."
            )))
        }
    };
    if h.width == 0 || h.height == 0 {
        return Err(AppError::other("This TGA has no size."));
    }
    let pixels = h.width as u64 * h.height as u64;
    if pixels > MAX_PIXELS {
        return Err(AppError::other("This TGA is implausibly large."));
    }

    // Skip the image id and any colour map table before the pixels start.
    let map_bytes = h.color_map_len * (h.color_map_entry_bits as usize).div_ceil(8);
    let start = 18 + h.id_len + map_bytes;
    let data = bytes
        .get(start..)
        .ok_or_else(|| AppError::other("This TGA ends before its image data."))?;

    let pixels = pixels as usize;
    let mut rgb = vec![0u8; pixels * 3];

    if rle {
        let mut src = 0usize;
        let mut done = 0usize;
        while done < pixels {
            let packet = *data
                .get(src)
                .ok_or_else(|| AppError::other("This TGA ends mid-way through its image."))?;
            src += 1;
            let count = (packet & 0x7f) as usize + 1;
            if done + count > pixels {
                return Err(AppError::other("This TGA claims more pixels than it has."));
            }
            if packet & 0x80 != 0 {
                // Run: one pixel repeated.
                let px = data
                    .get(src..src + bytes_per_px)
                    .ok_or_else(|| AppError::other("This TGA ends mid-way through a run."))?;
                src += bytes_per_px;
                let mut out = [0u8; 3];
                pixel_to_rgb(px, h.bits, &mut out);
                for i in 0..count {
                    rgb[(done + i) * 3..(done + i) * 3 + 3].copy_from_slice(&out);
                }
            } else {
                let need = count * bytes_per_px;
                let chunk = data
                    .get(src..src + need)
                    .ok_or_else(|| AppError::other("This TGA ends mid-way through a block."))?;
                src += need;
                for i in 0..count {
                    pixel_to_rgb(
                        &chunk[i * bytes_per_px..],
                        h.bits,
                        &mut rgb[(done + i) * 3..(done + i) * 3 + 3],
                    );
                }
            }
            done += count;
        }
    } else {
        let need = pixels * bytes_per_px;
        let raw = data
            .get(..need)
            .ok_or_else(|| AppError::other("This TGA is shorter than its header claims."))?;
        for i in 0..pixels {
            pixel_to_rgb(
                &raw[i * bytes_per_px..],
                h.bits,
                &mut rgb[i * 3..i * 3 + 3],
            );
        }
    }

    // Bit 5 of the descriptor: set means the first row stored is the top one. Paint files are
    // usually bottom-up, and getting this wrong silently shows the car upside down.
    let top_down = h.descriptor & 0x20 != 0;
    if !top_down {
        let stride = h.width as usize * 3;
        for y in 0..(h.height as usize / 2) {
            let (a, b) = rgb.split_at_mut((y + 1) * stride);
            let top = &mut a[y * stride..];
            let bottom = &mut b[(h.height as usize - 2 * y - 2) * stride..][..stride];
            top.swap_with_slice(bottom);
        }
    }

    Ok(Image {
        width: h.width,
        height: h.height,
        rgb,
    })
}

/// Average down to fit `max_edge`, so a 2048 sheet does not travel to a 280-pixel card.
pub fn downscale(img: &Image, max_edge: u32) -> Image {
    let longest = img.width.max(img.height);
    if max_edge == 0 || longest <= max_edge {
        return Image {
            width: img.width,
            height: img.height,
            rgb: img.rgb.clone(),
        };
    }
    let scale = max_edge as f64 / longest as f64;
    let w = (img.width as f64 * scale).round().max(1.0) as u32;
    let h = (img.height as f64 * scale).round().max(1.0) as u32;
    let mut out = vec![0u8; w as usize * h as usize * 3];

    let xs = img.width as f64 / w as f64;
    let ys = img.height as f64 / h as f64;
    for y in 0..h as usize {
        let y0 = (y as f64 * ys) as usize;
        let y1 = (((y + 1) as f64 * ys) as usize).clamp(y0 + 1, img.height as usize);
        for x in 0..w as usize {
            let x0 = (x as f64 * xs) as usize;
            let x1 = (((x + 1) as f64 * xs) as usize).clamp(x0 + 1, img.width as usize);
            let (mut r, mut g, mut b, mut n) = (0u32, 0u32, 0u32, 0u32);
            for sy in y0..y1 {
                let row = sy * img.width as usize;
                for sx in x0..x1 {
                    let i = (row + sx) * 3;
                    r += img.rgb[i] as u32;
                    g += img.rgb[i + 1] as u32;
                    b += img.rgb[i + 2] as u32;
                    n += 1;
                }
            }
            let o = (y * w as usize + x) * 3;
            out[o] = (r / n) as u8;
            out[o + 1] = (g / n) as u8;
            out[o + 2] = (b / n) as u8;
        }
    }
    Image {
        width: w,
        height: h,
        rgb: out,
    }
}

pub fn to_png(img: &Image) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, img.width, img.height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| AppError::other(format!("Could not encode the preview: {e}")))?;
        writer
            .write_image_data(&img.rgb)
            .map_err(|e| AppError::other(format!("Could not encode the preview: {e}")))?;
    }
    Ok(out)
}

/// Path and requested size — the same file at two sizes is two entries.
type CacheKey = (String, u32);
/// File size and modification time alongside the encoded PNG, so a repaint of the same
/// file is noticed rather than served stale.
type CacheEntry = (u64, Option<SystemTime>, Vec<u8>);

static CACHE: Mutex<Option<HashMap<CacheKey, CacheEntry>>> = Mutex::new(None);

/// Decode a paint file and hand back a PNG of it, memoised on size and modification time.
pub fn render_file(path: &Path, max_edge: u32) -> Result<Vec<u8>> {
    let md = std::fs::metadata(path)?;
    if md.len() > MAX_SOURCE_BYTES {
        return Err(AppError::other("That texture is too large to preview."));
    }
    let key = (path.to_string_lossy().to_ascii_lowercase(), max_edge);
    let len = md.len();
    let modified = md.modified().ok();

    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        if let Some((l, m, png)) = map.get(&key) {
            if *l == len && *m == modified {
                return Ok(png.clone());
            }
        }
    }

    let bytes = std::fs::read(path)?;
    let png = to_png(&downscale(&decode(&bytes)?, max_edge))?;

    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        // Crude, but it keeps a big library from pinning every paint in memory.
        if map.len() >= MAX_CACHE_ENTRIES {
            map.clear();
        }
        map.insert(key, (len, modified, png.clone()));
    }
    Ok(png)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build an uncompressed TGA the way the pipeline writes them: 24-bit, bottom-up.
    fn uncompressed_bgr(w: u16, h: u16, rows_bottom_up: &[[u8; 3]], top_down: bool) -> Vec<u8> {
        let mut v = vec![0u8; 18];
        v[2] = 2;
        v[12..14].copy_from_slice(&w.to_le_bytes());
        v[14..16].copy_from_slice(&h.to_le_bytes());
        v[16] = 24;
        v[17] = if top_down { 0x20 } else { 0x00 };
        for px in rows_bottom_up {
            v.extend_from_slice(&[px[2], px[1], px[0]]); // stored BGR
        }
        v
    }

    const RED: [u8; 3] = [255, 0, 0];
    const GREEN: [u8; 3] = [0, 255, 0];

    #[test]
    fn decodes_bgr_into_rgb() {
        // One pixel, red. Stored BGR, so a decoder that forgets to swap returns blue.
        let tga = uncompressed_bgr(1, 1, &[RED], true);
        let img = decode(&tga).unwrap();
        assert_eq!(img.rgb, vec![255, 0, 0]);
    }

    #[test]
    fn flips_bottom_up_images() {
        // Two rows: red stored first (the bottom row), green second (the top row).
        // Bottom-up means the output must start with green.
        let tga = uncompressed_bgr(1, 2, &[RED, GREEN], false);
        let img = decode(&tga).unwrap();
        assert_eq!(&img.rgb[0..3], &[0, 255, 0], "top row should be green");
        assert_eq!(&img.rgb[3..6], &[255, 0, 0], "bottom row should be red");

        // The same bytes marked top-down must not be flipped.
        let tga = uncompressed_bgr(1, 2, &[RED, GREEN], true);
        let img = decode(&tga).unwrap();
        assert_eq!(&img.rgb[0..3], &[255, 0, 0]);
    }

    #[test]
    fn decodes_run_length_encoding() {
        // A run of 3 red, then 2 literal pixels (green, red).
        let mut v = vec![0u8; 18];
        v[2] = 10; // RLE true colour
        v[12..14].copy_from_slice(&5u16.to_le_bytes());
        v[14..16].copy_from_slice(&1u16.to_le_bytes());
        v[16] = 24;
        v[17] = 0x20;
        v.push(0x80 | 2); // run of 3
        v.extend_from_slice(&[0, 0, 255]); // BGR red
        v.push(1); // 2 literals
        v.extend_from_slice(&[0, 255, 0]); // green
        v.extend_from_slice(&[0, 0, 255]); // red

        let img = decode(&v).unwrap();
        assert_eq!(img.width, 5);
        assert_eq!(
            img.rgb,
            vec![255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0, 0]
        );
    }

    #[test]
    fn a_truncated_file_is_an_error_not_a_panic() {
        let mut tga = uncompressed_bgr(4, 4, &[RED], false);
        tga.truncate(20);
        assert!(decode(&tga).is_err());
        assert!(decode(&[]).is_err());
        assert!(decode(&[0u8; 18]).is_err());
    }

    #[test]
    fn colour_mapped_files_are_refused_by_name() {
        let mut v = uncompressed_bgr(1, 1, &[RED], true);
        v[1] = 1; // colour map present
        v[2] = 1; // colour-mapped image
        let err = decode(&v).unwrap_err().to_string();
        assert!(err.contains("colour map"), "{err}");
    }

    #[test]
    fn a_lying_header_does_not_over_read() {
        // Claims 4x4 but carries one pixel. Must refuse rather than read past the buffer.
        let mut v = uncompressed_bgr(1, 1, &[RED], true);
        v[12..14].copy_from_slice(&4u16.to_le_bytes());
        v[14..16].copy_from_slice(&4u16.to_le_bytes());
        assert!(decode(&v).is_err());
    }

    #[test]
    fn downscale_averages_rather_than_drops() {
        // A 2x1 image of pure red and pure green must average to a single olive pixel, not
        // pick one of them.
        let img = Image {
            width: 2,
            height: 1,
            rgb: vec![255, 0, 0, 0, 255, 0],
        };
        let small = downscale(&img, 1);
        assert_eq!(small.width, 1);
        assert_eq!(small.rgb, vec![127, 127, 0]);
    }

    #[test]
    fn downscale_leaves_small_images_alone() {
        let img = Image {
            width: 2,
            height: 2,
            rgb: vec![1; 12],
        };
        let same = downscale(&img, 64);
        assert_eq!((same.width, same.height), (2, 2));
    }

    #[test]
    fn encodes_a_readable_png() {
        let img = Image {
            width: 2,
            height: 1,
            rgb: vec![255, 0, 0, 0, 255, 0],
        };
        let png = to_png(&img).unwrap();
        assert_eq!(&png[1..4], b"PNG");
        // And it round-trips through a decoder that is not ours.
        let decoder = png::Decoder::new(std::io::Cursor::new(&png));
        let mut reader = decoder.read_info().unwrap();
        let mut buf = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut buf).unwrap();
        assert_eq!((info.width, info.height), (2, 1));
        assert_eq!(&buf[..6], &[255, 0, 0, 0, 255, 0]);
    }

    #[test]
    fn renders_a_file_and_caches_it() {
        let dir = std::env::temp_dir().join("doooom-tga-test");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("car.tga");
        std::fs::write(&p, uncompressed_bgr(1, 1, &[RED], true)).unwrap();

        let first = render_file(&p, 64).unwrap();
        let second = render_file(&p, 64).unwrap();
        assert_eq!(first, second);
        assert_eq!(&first[1..4], b"PNG");

        std::fs::remove_dir_all(&dir).ok();
    }
}
