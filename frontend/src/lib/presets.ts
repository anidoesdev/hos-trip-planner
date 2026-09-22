export interface Preset {
  id: string
  title: string
  blurb: string
  current: string
  pickup: string
  dropoff: string
  cycle: number
}

export const PRESETS: Preset[] = [
  {
    id: 'short',
    title: 'Short haul',
    blurb: 'Single day, under 200 mi',
    current: 'Chicago, IL',
    pickup: 'Milwaukee, WI',
    dropoff: 'Madison, WI',
    cycle: 10,
  },
  {
    id: 'multiday',
    title: 'Cross-country',
    blurb: 'Chicago → Dallas → LA, multi-day',
    current: 'Chicago, IL',
    pickup: 'Dallas, TX',
    dropoff: 'Los Angeles, CA',
    cycle: 20,
  },
  {
    id: 'cycle',
    title: 'Near cycle limit',
    blurb: '62 h used — triggers a 34-hr restart',
    current: 'Atlanta, GA',
    pickup: 'Nashville, TN',
    dropoff: 'Denver, CO',
    cycle: 62,
  },
]
