import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, imagePart, getSentimentLabel } from '../server.js';

describe('1. Sentiment Label Mapping', () => {
  it('maps scores >= 0.05 to positive', () => {
    expect(getSentimentLabel(0.05)).toBe('positive');
    expect(getSentimentLabel(0.5)).toBe('positive');
    expect(getSentimentLabel(1.0)).toBe('positive');
  });

  it('maps scores between -0.05 and 0.05 to neutral', () => {
    expect(getSentimentLabel(0.049)).toBe('neutral');
    expect(getSentimentLabel(0)).toBe('neutral');
    expect(getSentimentLabel(-0.049)).toBe('neutral');
  });

  it('maps scores <= -0.05 to negative', () => {
    expect(getSentimentLabel(-0.05)).toBe('negative');
    expect(getSentimentLabel(-0.5)).toBe('negative');
    expect(getSentimentLabel(-1.0)).toBe('negative');
  });
});

describe('2. Input Validation (imagePart & payload limits)', () => {
  it('accepts valid JPEG, PNG, WEBP, and GIF data URLs', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const parsed = imagePart(png);
    expect(parsed).toBeDefined();
    expect(parsed.inline_data.mime_type).toBe('image/png');
    expect(parsed.inline_data.data).toBeDefined();

    const jpeg = 'data:image/jpeg;base64,dGVzdA==';
    expect(imagePart(jpeg).inline_data.mime_type).toBe('image/jpeg');

    const webp = 'data:image/webp;base64,dGVzdA==';
    expect(imagePart(webp).inline_data.mime_type).toBe('image/webp');
  });

  it('rejects non-image data URLs', () => {
    expect(() => imagePart('data:application/pdf;base64,JVBERi0xLjQK')).toThrow(/Invalid image format/i);
    expect(() => imagePart('data:text/plain;base64,SGVsbG8=')).toThrow(/Invalid image format/i);
    expect(() => imagePart('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toThrow(/Invalid image format/i);
  });

  it('returns null on empty or invalid inputs', () => {
    expect(imagePart('')).toBeNull();
    expect(imagePart(null)).toBeNull();
    expect(imagePart(undefined)).toBeNull();
    expect(imagePart(12345)).toBeNull();
  });

  it('rejects images exceeding 8 MB size limit', () => {
    // 11 million chars base64 is ~8.25 MB
    const hugeBase64 = 'A'.repeat(11 * 1024 * 1024);
    expect(() => imagePart('data:image/jpeg;base64,' + hugeBase64)).toThrow(/8 MB size limit/i);
  });
});

describe('3. Route Protection & requireUser Middleware', () => {
  it('allows public access to /health without token', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows public access to /api/config and never reveals service role key', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('supabaseUrl');
    expect(res.body).toHaveProperty('supabaseAnonKey');
    expect(res.body).not.toHaveProperty('supabaseServiceRoleKey');
    expect(res.body).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    expect(res.text).not.toContain('SERVICE_ROLE');
  });

  it('rejects /api/caption with 401 when Authorization token is missing', async () => {
    const res = await request(app)
      .post('/api/caption')
      .send({ image: 'data:image/png;base64,dGVzdA==' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('rejects /api/items with 401 when Authorization header is malformed', async () => {
    const res = await request(app)
      .get('/api/items')
      .set('Authorization', 'Basic 123456');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authorization/i);
  });

  it('rejects /api/sentiment with 401 without token', async () => {
    const res = await request(app)
      .post('/api/sentiment')
      .send({ text: 'Hello world' });
    expect(res.status).toBe(401);
  });

  it('rejects /api/translate with 401 without token', async () => {
    const res = await request(app)
      .post('/api/translate')
      .send({ text: 'Hello', targetLang: 'Hindi' });
    expect(res.status).toBe(401);
  });
});

describe('4. Public Share Route (/s/:id)', () => {
  it('returns 404 HTML page when item does not exist or is private', async () => {
    const res = await request(app).get('/s/non-existent-uuid-123');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Content Not Available');
  });
});
