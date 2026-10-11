import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import { Domain } from '../models/Domain.js';
import { Monitor } from '../models/Monitor.js';
import { AppError } from '../utils/AppError.js';
import { audit } from '../services/audit.js';
import {
  normalizeDomain, generateProofToken, handleOwnershipLost, proofInstructions, verifyDomain, findOwnershipConflict, resumeOwnedMonitors, testReachability,
} from '../services/domainVerification.js';

const MAX_DOMAINS = 50;

const toPublic = (d, monitorCount = 0) => ({
  _id: d._id,
  domain: d.domain,
  status: d.status,
  method: d.method,
  verifiedAt: d.verifiedAt,
  lastCheckedAt: d.lastCheckedAt,
  lastError: d.lastError,
  instructions: proofInstructions(d),
  monitorCount,
  createdAt: d.createdAt,
});

const countMonitors = async (workspaceId, domain) =>
  Monitor.countDocuments({
    workspaceId,
    $or: [{ host: domain }, { host: `www.${domain}` }, { host: { $regex: `\\.${domain.replace(/\./g, '\\.')}$` } }],
  });

export const listDomains = asyncHandler(async (req, res) => {
  const domains = await Domain.find({ workspaceId: req.workspace._id }).sort({ createdAt: -1 });
  const out = await Promise.all(domains.map(async (d) => toPublic(d, await countMonitors(req.workspace._id, d.domain))));
  res.json({ success: true, data: { domains: out } });
});

export const addDomain = asyncHandler(async (req, res, next) => {
  const domain = normalizeDomain(req.body?.domain);
  if (!domain) return next(new AppError('Enter a domain name like example.com (IP addresses can’t be verified)', 400));

  const count = await Domain.countDocuments({ workspaceId: req.workspace._id });
  if (count >= MAX_DOMAINS) return next(new AppError(`You can add up to ${MAX_DOMAINS} domains`, 403));
  if (await Domain.exists({ workspaceId: req.workspace._id, domain })) {
    return next(new AppError(`${domain} is already in this workspace`, 409));
  }
  const conflict = await findOwnershipConflict(req.workspace._id, domain);
  if (conflict) {
    return next(new AppError(`${conflict} is already verified by another company on PulseWatch. If you work there, ask its owner to invite you to their workspace.`, 409, { code: 'DOMAIN_OWNED_ELSEWHERE' }));
  }

  const doc = await Domain.create({ workspaceId: req.workspace._id, domain, token: generateProofToken(), addedBy: req.user._id });
  audit(req, 'domain.added', { targetType: 'domain', targetId: doc._id, targetName: domain });
  res.status(201).json({ success: true, data: { domain: toPublic(doc, await countMonitors(req.workspace._id, domain)) } });
});

export const verifyDomainNow = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new AppError('Domain not found', 404));
  const doc = await Domain.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
  if (!doc) return next(new AppError('Domain not found', 404));

  // One company per domain: re-checked at verification time too (another workspace may have won the race).
  const conflict = await findOwnershipConflict(req.workspace._id, doc.domain);
  if (conflict) {
    return next(new AppError(`${conflict} is already verified by another company on PulseWatch.`, 409, { code: 'DOMAIN_OWNED_ELSEWHERE' }));
  }
  const before = doc.status;
  await verifyDomain(doc);
  let resumed = 0;
  if (doc.status === 'verified' && before !== 'verified') {
    resumed = await resumeOwnedMonitors(doc);
    audit(req, 'domain.verified', { targetType: 'domain', targetId: doc._id, targetName: doc.domain, meta: { method: doc.method, resumed } });
  }
  res.json({ success: true, data: { domain: toPublic(doc, await countMonitors(req.workspace._id, doc.domain)), resumed } });
});

/** One real request to the domain, so the customer knows their firewall lets PulseWatch through. */
export const reachabilityTest = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new AppError('Domain not found', 404));
  const doc = await Domain.findOne({ _id: req.params.id, workspaceId: req.workspace._id, status: 'verified' });
  if (!doc) return next(new AppError('Verify the domain first', 404));
  res.json({ success: true, data: await testReachability(doc.domain) });
});

export const removeDomain = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new AppError('Domain not found', 404));
  const doc = await Domain.findOneAndDelete({ _id: req.params.id, workspaceId: req.workspace._id });
  if (!doc) return next(new AppError('Domain not found', 404));
  audit(req, 'domain.removed', { targetType: 'domain', targetId: doc._id, targetName: doc.domain });
  if (doc.status === 'verified') await handleOwnershipLost(doc, { notify: false }); // its monitors stop: ownership no longer proven
  res.status(204).end();
});
