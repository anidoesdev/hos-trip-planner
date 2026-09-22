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
    title: 'Short haul · 1 day',
    blurb: 'Chicago → Milwaukee → Madison',
    current: 'Chicago, IL',
    pickup: 'Milwaukee, WI',
    dropoff: 'Madison, WI',
    cycle: 10,
  },
  {
    id: 'multiday',
    title: 'Cross-country · multi-day',
    blurb: 'Chicago → Dallas → Los Angeles',
    current: 'Chicago, IL',
    pickup: 'Dallas, TX',
    dropoff: 'Los Angeles, CA',
    cycle: 20,
  },
  {
    id: 'cycle',
    title: 'Near cycle limit · 34-hr restart',
    blurb: 'Atlanta → Nashville → Denver',
    current: 'Atlanta, GA',
    pickup: 'Nashville, TN',
    dropoff: 'Denver, CO',
    cycle: 62,
  },
]
