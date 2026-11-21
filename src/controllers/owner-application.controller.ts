import type { Request, Response } from "express";
import { MongoServerError, ObjectId } from "mongodb";
import { ownerApplications, type OwnerApplication } from "../models/owner-application.js";
import { userCollection } from "../models/user.js";
import { isValidObjectId } from "../utils/validation.js";

const customerRole = { $or: [{ role: "customer" }, { role: { $exists: false } }] };

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ success: false, message });
}

function serialize(application: OwnerApplication) {
  const { _id, businessName, reason, additionalInformation, status, createdAt, reviewedAt, approvalStartedBy } = application;
  return { _id, businessName, reason, additionalInformation, status, createdAt, reviewedAt, approvalStarted: Boolean(approvalStartedBy) };
}

async function requester(req: Request, res: Response) {
  if (!req.user || !isValidObjectId(req.user.id)) {
    fail(res, 401, "A valid account is required.");
    return null;
  }
  const account = await userCollection().findOne({ _id: new ObjectId(req.user.id) });
  if (!account) fail(res, 401, "This account is no longer available.");
  return account;
}

export async function getMyApplication(req: Request, res: Response) {
  const user = await requester(req, res);
  if (!user) return;
  const application = await ownerApplications().findOne({ userId: user._id }, { sort: { createdAt: -1, _id: -1 } });
  res.json({ success: true, data: { application: application ? serialize(application) : null, hasOwnerAccess: user.role === "owner" } });
}

export async function submitApplication(req: Request, res: Response) {
  const user = await requester(req, res);
  if (!user) return;
  if (user.role !== undefined && user.role !== "customer") return fail(res, 403, "Only customers can apply.");
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => !["businessName", "reason", "additionalInformation"].includes(key))) {
    return fail(res, 400, "Submit only the application fields.");
  }
  const businessName = body.businessName === undefined ? "" : typeof body.businessName === "string" ? body.businessName.trim() : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const additionalInformation = body.additionalInformation === undefined ? "" : typeof body.additionalInformation === "string" ? body.additionalInformation.trim() : null;
  if (businessName === null || businessName.length > 100 || reason.length < 20 || reason.length > 1000 ||
      additionalInformation === null || additionalInformation.length > 500) {
    return fail(res, 400, "Enter a reason of 20–1000 characters, a name up to 100 characters, and optional notes up to 500 characters.");
  }

  const now = new Date();
  const application: OwnerApplication = {
    _id: new ObjectId(), userId: user._id, businessName, reason, additionalInformation,
    status: "pending", createdAt: now, updatedAt: now,
  };
  try {
    await ownerApplications().insertOne(application);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return fail(res, 409, "You already have a pending application.");
    }
    throw error;
  }
  res.status(201).json({ success: true, data: serialize(application) });
}

async function currentAdmin(req: Request, res: Response) {
  const user = await requester(req, res);
  if (!user) return null;
  if (user.role === "admin") return user;
  fail(res, 403, "Administrator access is required.");
  return null;
}

export async function listApplications(req: Request, res: Response) {
  if (!await currentAdmin(req, res)) return;
  const rawPage = req.query.page;
  const page = rawPage === undefined ? 1 : typeof rawPage === "string" ? Number(rawPage) : NaN;
  const limit = 10;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * limit)) {
    return fail(res, 400, "Enter a valid page number.");
  }

  const applications = ownerApplications();
  const [rows, total] = await Promise.all([
    applications.find().sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    applications.countDocuments(),
  ]);
  const ids = rows.map(({ userId }) => userId);
  const users = await userCollection().find({ _id: { $in: ids } }, { projection: { name: 1, email: 1 } }).toArray();
  const applicants = new Map(users.map(({ _id, name, email }) => [_id.toHexString(), { name, email }]));
  res.json({
    success: true,
    data: rows.map((row) => ({ ...serialize(row), applicant: applicants.get(row.userId.toHexString()) ?? null })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function reviewApplication(req: Request, res: Response) {
  const admin = await currentAdmin(req, res);
  if (!admin) return;
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!isValidObjectId(id)) return fail(res, 400, "Invalid application ID.");
  const status = req.body?.status;
  if ((status !== "approved" && status !== "rejected") || Object.keys(req.body).length !== 1) {
    return fail(res, 400, "Choose approved or rejected.");
  }

  const _id = new ObjectId(id);
  const applications = ownerApplications();
  const users = userCollection();
  const application = await applications.findOne({ _id });
  if (!application) return fail(res, 404, "Application not found.");
  if (application.status === status) {
    res.json({ success: true, data: serialize(application) });
    return;
  }
  if (application.status !== "pending") return fail(res, 409, "This application has already been reviewed.");

  const eligible = { _id: application.userId, ownerApprovalId: { $ne: _id }, ...customerRole };
  if (status === "approved" && !await users.findOne({
    _id: application.userId,
    $or: [...customerRole.$or, { role: "owner", ownerApprovalId: _id }],
  })) {
    return fail(res, 409, "The applicant no longer has an eligible customer account.");
  }

  const now = new Date();
  if (status === "rejected") {
    const rejected = await applications.findOneAndUpdate(
      { _id, status: "pending", approvalStartedBy: { $exists: false } },
      { $set: { status, reviewedAt: now, reviewedBy: admin._id, updatedAt: now } },
      { returnDocument: "after" },
    );
    const result = rejected ?? await applications.findOne({ _id, status: "rejected" });
    if (!result) return fail(res, 409, "An approval or another decision is in progress. Refresh the list.");
    res.json({ success: true, data: serialize(result) });
    return;
  }

  // Claim approval before changing the role. A competing rejection cannot pass
  // this claim, and a retry can finish a partially completed approval.
  const claim = application.approvalStartedBy ? application : await applications.findOneAndUpdate(
    { _id, status: "pending", approvalStartedBy: { $exists: false } },
    { $set: { approvalStartedBy: admin._id, updatedAt: now } },
    { returnDocument: "after" },
  ) ?? await applications.findOne({ _id, status: { $in: ["pending", "approved"] }, approvalStartedBy: { $exists: true } });
  if (!claim) return fail(res, 409, "This application has already been reviewed.");
  if (claim.status === "approved") {
    res.json({ success: true, data: serialize(claim) });
    return;
  }
  const reviewer = claim.approvalStartedBy;
  if (!reviewer) throw new Error("Owner approval has no reviewer.");

  const promoted = await users.updateOne(eligible, { $set: { role: "owner", ownerApprovalId: _id, updatedAt: now } });
  if (!promoted.matchedCount && !await users.findOne({ _id: application.userId, role: "owner", ownerApprovalId: _id })) {
    return fail(res, 409, "The applicant no longer has an eligible customer account.");
  }
  const approved = await applications.findOneAndUpdate(
    { _id, status: "pending", approvalStartedBy: { $exists: true } },
    { $set: { status, reviewedAt: now, reviewedBy: reviewer, updatedAt: now } },
    { returnDocument: "after" },
  ) ?? await applications.findOne({ _id, status: "approved" });
  if (!approved) throw new Error("Could not finalize owner approval.");
  res.json({ success: true, data: serialize(approved) });
}
