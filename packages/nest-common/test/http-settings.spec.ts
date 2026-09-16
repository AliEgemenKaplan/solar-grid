import { corsOriginsFrom, isSwaggerEnabled } from '../src/http/configure-http-app';

const config = (values: Record<string, string | undefined>) => ({
  get: <T>(key: string) => values[key] as T,
});

describe('isSwaggerEnabled', () => {
  it('is on in development and test', () => {
    expect(isSwaggerEnabled(config({ NODE_ENV: 'development' }) as never)).toBe(true);
    expect(isSwaggerEnabled(config({ NODE_ENV: 'test' }) as never)).toBe(true);
    expect(isSwaggerEnabled(config({}) as never)).toBe(true);
  });

  it('is off in production unless asked for', () => {
    expect(isSwaggerEnabled(config({ NODE_ENV: 'production' }) as never)).toBe(false);
    expect(
      isSwaggerEnabled(config({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }) as never),
    ).toBe(true);
  });

  it('lets an explicit setting win in either direction', () => {
    expect(
      isSwaggerEnabled(config({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }) as never),
    ).toBe(false);
  });
});

describe('corsOriginsFrom', () => {
  it('allows no origin by default', () => {
    expect(corsOriginsFrom(config({}) as never)).toEqual([]);
  });

  it('reads an explicit list', () => {
    expect(
      corsOriginsFrom(
        config({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173, https://grid.example' }) as never,
      ),
    ).toEqual(['http://localhost:5173', 'https://grid.example']);
  });

  it('refuses a wildcard rather than honouring it', () => {
    expect(corsOriginsFrom(config({ CORS_ALLOWED_ORIGINS: '*' }) as never)).toEqual([]);
    expect(
      corsOriginsFrom(config({ CORS_ALLOWED_ORIGINS: '*, http://localhost:5173' }) as never),
    ).toEqual(['http://localhost:5173']);
  });
});
