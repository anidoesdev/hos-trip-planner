export type LatLng = [number, number]

const R_MI = 3958.7613

/** Great-circle distance in miles. */
export function haversineMiles([la1, lo1]: LatLng, [la2, lo2]: LatLng): number {
  const r = Math.PI / 180
  const h =
    Math.sin(((la2 - la1) * r) / 2) ** 2 +
    Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(h)))
}
