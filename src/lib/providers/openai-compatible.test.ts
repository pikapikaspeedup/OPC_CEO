import { describe, expect, it } from 'vitest';

import {
  buildOpenAICompatibleImagesUrl,
  buildOpenAICompatibleModelsUrl,
} from './openai-compatible';

describe('openai-compatible helpers', () => {
  it('appends /v1 only when the base URL does not already contain it', () => {
    expect(buildOpenAICompatibleModelsUrl('https://new.baogaoai.com')).toBe('https://new.baogaoai.com/v1/models');
    expect(buildOpenAICompatibleModelsUrl('https://new.baogaoai.com/v1')).toBe('https://new.baogaoai.com/v1/models');
  });

  it('builds image endpoints without duplicating /v1', () => {
    expect(buildOpenAICompatibleImagesUrl('https://new.baogaoai.com')).toBe('https://new.baogaoai.com/v1/images/generations');
    expect(buildOpenAICompatibleImagesUrl('https://new.baogaoai.com/v1')).toBe('https://new.baogaoai.com/v1/images/generations');
  });
});
