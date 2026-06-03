/**
 * GET /api/email-campaigns/[id]/variant-stats
 *
 * Métricas agregadas por step × variante de la campaña.
 * Permite ver qué subject/body funciona mejor (A/B testing).
 *
 * Cuenta:
 *   - sent: envíos exitosos (de email-sent, type=campaign, ok=true)
 *   - bounced: envíos con status SMTP permanente fallido (de email-sent ok=false con error 5xx)
 *   - replied: leads con status=replied que recibieron esa variante en ese step (de email-sent)
 *
 * Para cada step, marca como "ganadora" la variante con mayor reply_rate
 * (mínimo 20 envíos para considerarse significativo).
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, listLeads } from "@/lib/email-campaigns";
import { listSent } from "@/lib/email-sent-log";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  const [sentAll, leads] = await Promise.all([listSent(), listLeads(id)]);

  // Filtra los envíos de esta campaña
  const sent = sentAll.filter((s) => s.campaign_id === id && s.type === "campaign");

  // Lead → status (para saber quién respondió)
  const leadStatus = new Map<string, string>();
  for (const l of leads) leadStatus.set(l.id, l.status);

  type VariantStats = {
    variant_id: string;
    label: string;
    subject_preview: string;
    sent: number;
    delivered: number;       // sent OK
    bounced: number;          // SMTP 5xx
    replied: number;          // lead.status === "replied"
    reply_rate: number;       // % (sobre delivered)
    bounce_rate: number;      // % (sobre intentados)
    is_winner: boolean;
  };

  type StepStats = {
    step_index: number;
    step_id: string;
    delay_days: number;
    variants: VariantStats[];
  };

  const stepStats: StepStats[] = campaign.steps.map((step, stepIdx) => {
    const variants: VariantStats[] = step.variants.map((v) => {
      const sentForVariant = sent.filter((s) =>
        s.campaign_step === stepIdx + 1 && s.campaign_variant === v.label
      );
      const delivered = sentForVariant.filter((s) => s.ok).length;
      const bounced = sentForVariant.filter((s) => !s.ok).length;

      // Replied: lead ids en este variant cuya lead.status = "replied"
      const leadIdsInVariant = new Set(
        sentForVariant.filter((s) => s.ok && s.lead_id).map((s) => s.lead_id!)
      );
      let replied = 0;
      for (const lid of leadIdsInVariant) {
        if (leadStatus.get(lid) === "replied") replied++;
      }

      const total = delivered + bounced;
      return {
        variant_id: v.id,
        label: v.label,
        subject_preview: (v.subject || "").slice(0, 80),
        sent: total,
        delivered,
        bounced,
        replied,
        reply_rate: delivered > 0 ? (replied / delivered) * 100 : 0,
        bounce_rate: total > 0 ? (bounced / total) * 100 : 0,
        is_winner: false,
      };
    });

    // Marca ganadora: variante con mejor reply_rate, mínimo 20 envíos para ser significativo
    const eligible = variants.filter((v) => v.delivered >= 20);
    if (eligible.length >= 2) {
      const winner = eligible.reduce((best, v) => v.reply_rate > best.reply_rate ? v : best);
      if (winner.reply_rate > 0) {
        const idx = variants.findIndex((v) => v.variant_id === winner.variant_id);
        if (idx >= 0) variants[idx].is_winner = true;
      }
    }

    return {
      step_index: stepIdx,
      step_id: step.id,
      delay_days: step.delay_days,
      variants,
    };
  });

  // Totales globales
  const totals = {
    total_sent: sent.filter((s) => s.ok).length,
    total_bounced: sent.filter((s) => !s.ok).length,
    total_replied: leads.filter((l) => l.status === "replied").length,
    total_completed: leads.filter((l) => l.status === "completed").length,
    total_leads: leads.length,
  };

  return NextResponse.json({
    ok: true,
    campaign_id: id,
    campaign_name: campaign.name,
    totals,
    steps: stepStats,
  });
}
