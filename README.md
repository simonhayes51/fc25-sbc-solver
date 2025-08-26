# FC25 SBC Solution Finder

Automatically finds the cheapest solutions for FIFA/FC25 Squad Building Challenges, including multi-segment SBCs.

## Features

- ✅ Multi-segment SBC support (Icon Moments, POTM, etc.)
- ✅ Real-time price monitoring from multiple sources
- ✅ Cheapest player recommendations per segment
- ✅ Chemistry and rating calculations
- ✅ Export solutions to CSV
- ✅ Mobile-responsive dashboard

## Deployment on Railway

1. Fork this repository
2. Connect to Railway
3. Set environment variables:
   - `FUTBIN_API_KEY` (optional)
   - `FUTWIZ_API_KEY` (optional)
4. Deploy!

## API Endpoints

- `GET /api/sbc/solutions` - Get all SBC solutions
- `GET /api/sbc/solution/:name` - Get specific SBC solution
- `POST /api/sbc/update-prices` - Manually update prices
- `GET /api/sbc/active` - Get active SBCs from EA

## Local Development

```bash
npm install
npm run dev
