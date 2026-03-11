import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import { classifyWallet, type Archetype } from '@/lib/wallets/classify'

const BATCH_SIZE = 10

/**
 * POST /api/wallets/classify?address=0x...
 *
 * If address is provided, classify that single wallet.
 * If no address, classify all wallets in batches of 10.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase()
    const address = req.nextUrl.searchParams.get('address')

    if (address) {
      // Single wallet classification
      const result = await classifyWallet(address)

      const { error } = await supabase
        .from('wallets')
        .update({ tags: result.tags })
        .eq('address', result.address)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        data: { classified: 1, results: [result] },
      })
    }

    // Classify all wallets in batches
    const { data: wallets, error: fetchError } = await supabase
      .from('wallets')
      .select('address')
      .limit(500)

    if (fetchError || !wallets) {
      return NextResponse.json({ success: false, error: fetchError?.message || 'No wallets found' }, { status: 500 })
    }

    const results: Array<{ address: string; tags: Archetype[] }> = []
    const tagSummary: Record<string, number> = {}

    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
      const batch = wallets.slice(i, i + BATCH_SIZE)

      const batchResults = await Promise.all(
        batch.map(async (w) => {
          try {
            return await classifyWallet(w.address)
          } catch {
            return { address: w.address.toLowerCase(), tags: ['unclassified' as Archetype] }
          }
        })
      )

      // Update tags in Supabase for each result
      for (const result of batchResults) {
        await supabase
          .from('wallets')
          .update({ tags: result.tags })
          .eq('address', result.address)

        results.push(result)
        for (const tag of result.tags) {
          tagSummary[tag] = (tagSummary[tag] || 0) + 1
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        classified: results.length,
        tagSummary,
        results,
      },
    })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
