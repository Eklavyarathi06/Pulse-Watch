import crypto from 'crypto';
import os from 'os';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

/**
 * Leader election through a MongoDB lease, so any number of API instances can run behind a
 * load balancer while exactly one of them runs the background work (scheduled checks, nightly
 * rollups, billing maintenance). If the leader dies, another instance takes over within ~30 s.
 */
const LEASE_MS = 30_000;
const RENEW_MS = 10_000;
const LOCK_ID = 'background-jobs';
const ME = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

let leader = false;

const tryAcquire = async () => {
  const locks = mongoose.connection.db.collection('locks');
  const now = new Date();
  try {
    const res = await locks.findOneAndUpdate(
      { _id: LOCK_ID, $or: [{ owner: ME }, { expiresAt: { $lt: now } }] },
      { $set: { owner: ME, expiresAt: new Date(now.getTime() + LEASE_MS) } },
      { upsert: true, returnDocument: 'after' }
    );
    const won = (res?.value ?? res)?.owner === ME;
    if (won !== leader) logger.info(won ? `This instance (${ME}) is now running background jobs.` : 'Background jobs moved to another instance.');
    leader = won;
  } catch (err) {
    // Duplicate key = someone else holds a live lease.
    if (err.code !== 11000) logger.warn(`Leader lease error: ${err.message}`);
    if (leader) logger.info('Background jobs moved to another instance.');
    leader = false;
  }
};

export const isLeader = () => leader;

export const startLeaderElection = async () => {
  await tryAcquire();
  setInterval(tryAcquire, RENEW_MS).unref();
};

export const releaseLeadership = async () => {
  if (!leader) return;
  await mongoose.connection.db.collection('locks').deleteOne({ _id: LOCK_ID, owner: ME }).catch(() => {});
  leader = false;
};
