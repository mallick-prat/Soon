/**
 * demo seed for local development — creates one user, a few contacts, and
 * scheduling sessions in varied states so /upcoming, /approvals and
 * /scheduled all have something to show.
 *
 * run with: DATABASE_URL=... pnpm tsx prisma/seed.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../packages/database/src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required to seed");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function main() {
  const now = new Date();

  const user = await db.user.upsert({
    where: { email: "demo@soon.example" },
    update: {},
    create: {
      email: "demo@soon.example",
      name: "demo user",
      timezone: "America/New_York",
      approvalMode: "approve_every",
      triggerEmoji: "⏳",
      calendarPreference: {
        create: {
          destinationCalendarId: "primary",
          blockingCalendarIds: ["primary", "work@group.calendar.google.com"],
          workingHoursJson: [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            start: "09:00",
            end: "18:00",
          })),
          preferredWindowsJson: [
            { weekday: 2, start: "14:00", end: "17:00", weight: 2 },
            { weekday: 4, start: "10:00", end: "12:00", weight: 1 },
          ],
          timezone: "America/New_York",
        },
      },
      stylePreference: {
        create: { mode: "adaptive", formality: "casual", emojiEnabled: false },
      },
      macDevices: {
        create: {
          deviceName: "demo macbook",
          devicePublicKey: "demo-device-public-key-0001",
          status: "active",
          lastSeenAt: new Date(now.getTime() - 4 * 60 * 1000),
          messagesPermissionStatus: "granted",
          appVersion: "0.1.0",
        },
      },
    },
  });

  async function contactWithConversation(
    phone: string,
    displayName: string,
    relationshipType:
      | "close_friend"
      | "founder"
      | "investor"
      | "colleague"
      | "unknown",
  ) {
    const contact = await db.contact.upsert({
      where: { userId_normalizedPhone: { userId: user.id, normalizedPhone: phone } },
      update: {},
      create: {
        userId: user.id,
        normalizedPhone: phone,
        displayName,
        relationshipType,
        timezone: "America/New_York",
      },
    });
    const conversation = await db.conversation.upsert({
      where: {
        userId_localConversationReference: {
          userId: user.id,
          localConversationReference: `imessage;-;${phone}`,
        },
      },
      update: {},
      create: {
        userId: user.id,
        localConversationReference: `imessage;-;${phone}`,
        conversationType: "direct",
        participantHash: `hash-${phone}`,
        contactId: contact.id,
      },
    });
    return { contact, conversation };
  }

  const maya = await contactWithConversation("+15551230001", "maya chen", "founder");
  const sam = await contactWithConversation("+15551230002", "sam okafor", "close_friend");
  const priya = await contactWithConversation("+15551230003", "priya patel", "investor");
  const leo = await contactWithConversation("+15551230004", "leo martin", "colleague");

  // 1. awaiting user approval — draft pending review
  const s1 = await db.schedulingSession.create({
    data: {
      userId: user.id,
      conversationId: maya.conversation.id,
      state: "awaiting_user_approval",
      meetingType: "coffee",
      durationMinutes: 45,
      meetingFormat: "in_person",
      location: "blue bottle, hayes valley",
      timezone: "America/New_York",
      approvalMode: "approve_every",
      waitingOn: "user",
      proposalRound: 1,
      triggerMessageReference: "msg-ref-1001",
      lastInboundAt: new Date(now.getTime() - 2 * HOUR),
      participants: {
        create: { handle: "+15551230001", displayName: "maya chen", contactId: maya.contact.id },
      },
      candidateSlots: {
        create: [
          {
            startsAt: new Date(now.getTime() + 2 * DAY + 14 * HOUR),
            endsAt: new Date(now.getTime() + 2 * DAY + 14.75 * HOUR),
            timezone: "America/New_York",
            status: "candidate",
            score: 0.92,
            proposalRound: 1,
          },
          {
            startsAt: new Date(now.getTime() + 3 * DAY + 10 * HOUR),
            endsAt: new Date(now.getTime() + 3 * DAY + 10.75 * HOUR),
            timezone: "America/New_York",
            status: "candidate",
            score: 0.85,
            proposalRound: 1,
          },
        ],
      },
      messages: {
        create: {
          localMessageReference: "msg-ref-1001",
          senderType: "attendee",
          direction: "inbound",
          sanitizedText: "coffee soon? been too long",
          messageTimestamp: new Date(now.getTime() - 2 * HOUR),
        },
      },
    },
  });
  await db.outboundDraft.create({
    data: {
      sessionId: s1.id,
      objective: "propose_slots",
      text: "would love to! i could do thursday 2pm or friday 10am — either work?",
      alternativeTexts: [
        "yes! thursday 2pm or friday 10am work on my end",
      ],
      confidence: 0.91,
      requiresApproval: true,
      status: "pending",
      approvalState: "pending",
      expiresAt: new Date(now.getTime() + 22 * HOUR),
    },
  });

  // 2. waiting for attendee — proposal sent, follow-up scheduled in 2 days
  const s2Policy = await db.followUpPolicy.create({
    data: {
      userId: user.id,
      enabled: true,
      mode: "approve_each",
      intervalHours: [48, 120, 240],
      maximumAttempts: 3,
      sessionMaxDays: 30,
      quietHoursJson: { earliest: "09:00", latest: "19:00", timezone: "America/New_York" },
    },
  });
  const s2 = await db.schedulingSession.create({
    data: {
      userId: user.id,
      conversationId: sam.conversation.id,
      state: "waiting_for_attendee",
      meetingType: "dinner",
      durationMinutes: 90,
      meetingFormat: "in_person",
      timezone: "America/New_York",
      waitingOn: "attendee",
      proposalRound: 1,
      outboundMessageCount: 1,
      followUpPolicyId: s2Policy.id,
      nextActionAt: new Date(now.getTime() + 2 * DAY),
      nextActionType: "send_follow_up",
      lastOutboundAt: new Date(now.getTime() - 6 * HOUR),
      participants: {
        create: { handle: "+15551230002", displayName: "sam okafor", contactId: sam.contact.id },
      },
      messages: {
        create: {
          localMessageReference: "msg-ref-2002",
          senderType: "user",
          direction: "outbound",
          sanitizedText: "dinner next week? i could do tuesday or wednesday evening",
          messageTimestamp: new Date(now.getTime() - 6 * HOUR),
        },
      },
    },
  });
  await db.followUpAttempt.create({
    data: {
      sessionId: s2.id,
      policyId: s2Policy.id,
      attemptNumber: 1,
      scheduledFor: new Date(now.getTime() + 2 * DAY),
      status: "scheduled",
      idempotencyKey: `follow-up:${s2.id}:1`,
    },
  });

  // 3. follow-up due today
  const s3Policy = await db.followUpPolicy.create({
    data: {
      userId: user.id,
      enabled: true,
      mode: "approve_each",
      intervalHours: [48, 120],
      maximumAttempts: 2,
      sessionMaxDays: 21,
      quietHoursJson: { earliest: "09:00", latest: "19:00", timezone: "America/New_York" },
    },
  });
  const s3 = await db.schedulingSession.create({
    data: {
      userId: user.id,
      conversationId: priya.conversation.id,
      state: "follow_up_due",
      meetingType: "quick_call",
      durationMinutes: 15,
      meetingFormat: "phone",
      timezone: "America/New_York",
      waitingOn: "system",
      proposalRound: 2,
      outboundMessageCount: 2,
      followUpPolicyId: s3Policy.id,
      nextActionAt: new Date(now.getTime() + 3 * HOUR),
      nextActionType: "send_follow_up",
      lastOutboundAt: new Date(now.getTime() - 2 * DAY),
      participants: {
        create: { handle: "+15551230003", displayName: "priya patel", contactId: priya.contact.id },
      },
    },
  });
  await db.followUpAttempt.create({
    data: {
      sessionId: s3.id,
      policyId: s3Policy.id,
      attemptNumber: 1,
      scheduledFor: new Date(now.getTime() + 3 * HOUR),
      status: "awaiting_approval",
      idempotencyKey: `follow-up:${s3.id}:1`,
    },
  });

  // 4. scheduled — event created
  await db.schedulingSession.create({
    data: {
      userId: user.id,
      conversationId: leo.conversation.id,
      state: "scheduled",
      meetingType: "meeting",
      title: "roadmap sync",
      durationMinutes: 30,
      meetingFormat: "virtual",
      timezone: "America/New_York",
      calendarEventId: "demo-google-event-id-0001",
      proposalRound: 1,
      outboundMessageCount: 2,
      completedAt: new Date(now.getTime() - 1 * DAY),
      resolvedReason: "scheduled",
      participants: {
        create: { handle: "+15551230004", displayName: "leo martin", contactId: leo.contact.id },
      },
      candidateSlots: {
        create: {
          startsAt: new Date(now.getTime() + 4 * DAY + 15 * HOUR),
          endsAt: new Date(now.getTime() + 4 * DAY + 15.5 * HOUR),
          timezone: "America/New_York",
          status: "booked",
          score: 0.97,
          proposalRound: 1,
        },
      },
    },
  });

  // 5. paused / snoozed session
  await db.schedulingSession.create({
    data: {
      userId: user.id,
      conversationId: maya.conversation.id,
      state: "paused",
      meetingType: "lunch",
      durationMinutes: 60,
      meetingFormat: "in_person",
      timezone: "America/New_York",
      snoozedUntil: new Date(now.getTime() + 5 * DAY),
      resolvedReason: null,
    },
  });

  console.log("seeded demo user", user.email);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
