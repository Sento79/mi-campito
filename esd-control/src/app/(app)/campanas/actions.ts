"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { campaignSchema, createCampaign, resolveItems, skipItem, transitionCampaign, CAMPAIGN_STATUSES } from "@/lib/server/services/campaigns";

export const previewCampaignAction = defineAction({ permission: "create", schema: campaignSchema }, async (i, { tx }) => {
  const r = await resolveItems(tx, i);
  return { assets: r.assets.length, points: r.points.length };
});

export const createCampaignAction = defineAction({ permission: "create", schema: campaignSchema }, async (i, { tx, session }) => {
  const r = await createCampaign(tx, session, i);
  revalidatePath("/campanas");
  return r;
});

export const transitionCampaignAction = defineAction(
  { permission: ["edit", "campaign.close"], schema: z.object({ id: z.string().uuid(), to: z.enum([...CAMPAIGN_STATUSES, "pause", "resume"]), notes: z.string().trim().max(2000).nullable(), acknowledge: z.boolean().default(false) }) },
  async (i, { tx, session }) => {
    await transitionCampaign(tx, session, session.permissions, i.id, i.to, { notes: i.notes, acknowledge: i.acknowledge });
    revalidatePath(`/campanas/${i.id}`);
    return { id: i.id };
  },
);

export const skipItemAction = defineAction({ permission: "edit", schema: z.object({ itemId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }) }, async (i, { tx, session }) => {
  await skipItem(tx, session, i.itemId, i.reason);
  return { id: i.itemId };
});
