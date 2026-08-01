/**
 * Layer 5 of the PEGASUS stack: environment as variation axes.
 *
 * Presets rather than free numbers, because the renderer, the friction model
 * and the sensor model all have to agree on what "heavy rain" means; a preset
 * is a name they can each resolve, a raw `rainIntensity: 0.63` is three
 * independent guesses. The numeric fields exist for the cases where the
 * *criticality* depends on the exact value (sun-azimuth glare, friction) and
 * they accept expressions, so `env.frictionScale = param.friction` makes
 * friction a first-class sampled axis.
 *
 * `extensions` keeps this block genuinely extensible: a renderer-specific knob
 * lands there without a schema version bump, and nothing in this package reads
 * it.
 */

import { z } from 'zod';

import { NumberOrExprSchema } from '../../expr/index.js';
import { V2ExtensionsSchema } from './common.js';

/** Weather presets. Ordered roughly by severity. */
export const WEATHER_PRESETS = [
  'clear',
  'cloudy',
  'overcast',
  'light_rain',
  'heavy_rain',
  'wet_road',
  'fog_light',
  'fog_dense',
  'snow',
  'sleet',
] as const;

/** Time-of-day presets. `night_lit` is night with working street lighting. */
export const TIME_OF_DAY_PRESETS = [
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'dusk',
  'night',
  'night_lit',
] as const;

/** Weather preset. */
export const WeatherSchema = z.enum(WEATHER_PRESETS);
/** Time-of-day preset. */
export const TimeOfDaySchema = z.enum(TIME_OF_DAY_PRESETS);

/** The `environment` block. */
export const EnvironmentSchema = z.strictObject({
  weather: WeatherSchema.default('clear'),
  timeOfDay: TimeOfDaySchema.default('noon'),
  /**
   * Tyre-road friction multiplier against the map's nominal value. 1 = dry
   * asphalt. Set it explicitly when the scenario is *about* friction; leave it
   * out and the preset decides.
   */
  frictionScale: NumberOrExprSchema.optional(),
  /**
   * Sun azimuth in degrees clockwise from the corridor's forward direction —
   * *frame-relative*, not compass-absolute, so a glare scenario stays a glare
   * scenario when it retargets onto a road that runs the other way.
   */
  sunAzimuthDeg: NumberOrExprSchema.optional(),
  /** Sun elevation above the horizon, degrees. Low sun is the glare case. */
  sunElevationDeg: NumberOrExprSchema.optional(),
  /** Renderer/sensor-specific knobs. Nothing in this package interprets these. */
  extensions: V2ExtensionsSchema.optional(),
});

/** Resolved environment block. */
export type Environment = z.infer<typeof EnvironmentSchema>;
/** Weather preset. */
export type Weather = z.infer<typeof WeatherSchema>;
/** Time-of-day preset. */
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;
