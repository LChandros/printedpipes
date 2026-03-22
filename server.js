const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const TMP_DIR = path.join(__dirname, 'tmp');

// Ensure tmp dir exists
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Parameter validation ranges
const PARAM_RANGES = {
  elbow: {
    pipe_id: { min: 10, max: 150, default: 25.4 },
    wall_thickness: { min: 1, max: 10, default: 3 },
    angle: { min: 1, max: 180, default: 90 },
    bend_radius: { min: 15, max: 200, default: 40 },
    stub_length: { min: 5, max: 50, default: 20 },
  },
  reducer: {
    id_large: { min: 15, max: 150, default: 31.75 },
    id_small: { min: 10, max: 140, default: 19.05 },
    wall_thickness: { min: 1, max: 10, default: 3 },
    transition_length: { min: 10, max: 100, default: 30 },
    stub_length: { min: 5, max: 50, default: 20 },
  },
  escutcheon: {
    pipe_od: { min: 10, max: 120, default: 28.4 },
    plate_od: { min: 30, max: 200, default: 70 },
    thickness: { min: 1, max: 10, default: 3 },
    chamfer: { min: 0, max: 5, default: 1.5 },
    gap: { min: 0, max: 3, default: 0.5 },
  }
};

function validateParams(type, params) {
  const ranges = PARAM_RANGES[type];
  if (!ranges) return { valid: false, error: 'Unknown fitting type' };

  const validated = {};
  for (const [key, range] of Object.entries(ranges)) {
    const val = parseFloat(params[key]);
    if (isNaN(val)) {
      validated[key] = range.default;
    } else {
      validated[key] = Math.max(range.min, Math.min(range.max, val));
    }
  }

  // Reducer: large must be bigger than small
  if (type === 'reducer' && validated.id_large <= validated.id_small) {
    return { valid: false, error: 'Large diameter must be greater than small diameter' };
  }

  return { valid: true, params: validated };
}

// Generate STL from parameters
app.post('/api/generate', (req, res) => {
  const { type, params, preview } = req.body;

  const validation = validateParams(type, params || {});
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const templatePath = path.join(TEMPLATES_DIR, `${type}.scad`);
  if (!fs.existsSync(templatePath)) {
    return res.status(400).json({ error: 'Template not found' });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const outputPath = path.join(TMP_DIR, `${id}.stl`);

  // Build -D flags for each parameter
  const args = ['-o', outputPath];

  // Lower resolution for preview
  const fn = preview ? 32 : 64;
  for (const [key, val] of Object.entries(validation.params)) {
    args.push('-D', `${key}=${val}`);
  }
  args.push('-D', `$fn=${fn}`);
  args.push(templatePath);

  execFile('openscad', args, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('OpenSCAD error:', stderr);
      // Cleanup on error
      try { fs.unlinkSync(outputPath); } catch(e) {}
      return res.status(500).json({ error: 'Failed to generate STL' });
    }

    if (preview) {
      // Return STL content for Three.js to parse
      res.setHeader('Content-Type', 'application/octet-stream');
      const stream = fs.createReadStream(outputPath);
      stream.on('end', () => {
        try { fs.unlinkSync(outputPath); } catch(e) {}
      });
      stream.pipe(res);
    } else {
      // Download with nice filename
      const filename = `${type}_${Date.now()}.stl`;
      res.download(outputPath, filename, () => {
        try { fs.unlinkSync(outputPath); } catch(e) {}
      });
    }
  });
});

const PORT = process.env.PORT || 3007;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PrintedPipes running on http://0.0.0.0:${PORT}`);
});
