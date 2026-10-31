import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useProfiles } from '../lib/data'
import { api, errorMessage } from '../lib/api'
import type { PatientOption } from '../types'
import { Icon } from '../components/Icons'
import {
  AlertBox,
  Avatar,
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
} from '../components/ui'

export function CaregiverPage() {
  const { profile, patients, activeUserId, setActiveUserId } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const caregivers = useProfiles(profile?.caregivers || [])

  const [code, setCode] = useState<string | null>(null)
  const [revealCode, setRevealCode] = useState(false)
  const [redeem, setRedeem] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PatientOption | null>(null)
  const [leaveTarget, setLeaveTarget] = useState<PatientOption | null>(null)

  const shareCode = code || profile?.caregiverCode || ''

  async function generate() {
    setBusy('generate')
    try {
      const result = await api.generateCaregiverCode()
      setCode(result.code)
      setRevealCode(true)
      toast('New share code generated. Rotate it any time.', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function copyCode() {
    if (!shareCode) return
    try {
      await navigator.clipboard.writeText(shareCode)
      toast('Share code copied.', 'success')
    } catch {
      toast(`Share code: ${shareCode}`)
    }
  }

  async function redeemCode() {
    if (!redeem.trim()) return
    setBusy('redeem')
    try {
      const result = await api.redeemCaregiverCode(redeem.trim())
      toast(`Linked with ${result.ownerName}. Their records are now available.`, 'success')
      setRedeem('')
      setActiveUserId(result.ownerId)
      navigate('/')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function removeCaregiver() {
    if (!removeTarget) return
    setBusy('remove')
    try {
      await api.removeCaregiver(removeTarget.uid)
      toast('Caregiver access revoked immediately.', 'success')
      setRemoveTarget(null)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function leave() {
    if (!leaveTarget) return
    setBusy('leave')
    try {
      await api.leaveCaregiver(leaveTarget.uid)
      toast('You left this care circle.', 'success')
      setLeaveTarget(null)
      if (activeUserId === leaveTarget.uid) setActiveUserId(profile?.uid || '')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const caregiversHeading = `${caregivers.length} caregiver${caregivers.length === 1 ? '' : 's'}`

  return (
    <>
      <PageHeader
        title="Care circle"
        subtitle="Invite a family member to follow your schedule and log doses. Clinical records stay read-only for them, and you can revoke access at any moment."
        actions={<Badge tone="brand" dot>{caregivers.length} linked</Badge>}
      />

      <div className="grid two-col" style={{ gap: 16 }}>
        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHead
              title="Invite a caregiver"
              subtitle="Share this one-time code. They redeem it from their own MediVault account."
              actions={
                <Button size="sm" variant="ghost" icon="refresh" onClick={generate} loading={busy === 'generate'}>
                  {shareCode ? 'Rotate' : 'Generate'}
                </Button>
              }
            />
            <div className="card-pad">
              {shareCode ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div
                    className="mono"
                    style={{
                      flex: 1,
                      minWidth: 190,
                      fontSize: 26,
                      fontWeight: 700,
                      letterSpacing: '0.22em',
                      padding: '14px 16px',
                      borderRadius: 14,
                      background: 'var(--brand-50)',
                      border: '1px dashed #bfe6da',
                      color: 'var(--brand-700)',
                      textAlign: 'center',
                    }}
                  >
                    {revealCode ? shareCode : '••••••'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Button size="sm" variant="ghost" icon="copy" onClick={copyCode}>
                      Copy
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRevealCode((value) => !value)}>
                      {revealCode ? 'Hide' : 'Reveal'}
                    </Button>
                  </div>
                </div>
              ) : (
                <AlertBox tone="info" icon="shield">
                  No share code yet. Generate one to let a trusted person view your medicines,
                  appointments and prescriptions, and log doses on your behalf.
                </AlertBox>
              )}

              <div style={{ marginTop: 16 }}>
                <Field
                  label="Redeem someone else’s code"
                  htmlFor="redeem-code"
                  hint="Become a caregiver for a partner, parent or friend."
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input
                      id="redeem-code"
                      value={redeem}
                      onChange={(event) => setRedeem(event.target.value.toUpperCase())}
                      placeholder="ABC123"
                      maxLength={10}
                      style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}
                    />
                    <Button variant="soft" onClick={redeemCode} loading={busy === 'redeem'}>
                      Link
                    </Button>
                  </div>
                </Field>
              </div>

              <div className="alert-box info" style={{ marginTop: 14, fontSize: 12 }}>
                <Icon name="lock" size={14} />
                <span>
                  Codes are 6 characters from a confusion-free alphabet. Redeeming sets
                  <span className="mono"> caregivers </span> / <span className="mono">caregiverOf</span>{' '}
                  arrays through a Cloud Function — clients cannot edit those fields directly.
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead
              title="People cared for by you"
              subtitle={patients.length > 0 ? 'Switch the dashboard to their records at any time.' : 'No linked patients yet'}
            />
            {patients.length === 0 ? (
              <EmptyState
                icon="users"
                title="You are not caring for anyone yet"
                message="Enter the share code a patient gave you to start following their medication schedule."
              />
            ) : (
              <div className="list">
                {patients.map((patient) => (
                  <div key={patient.uid} className="list-row">
                    <Avatar name={patient.name} email={patient.email} />
                    <div className="grow">
                      <div className="title">
                        {patient.name}
                        {activeUserId === patient.uid ? <Badge tone="brand">Viewing</Badge> : null}
                      </div>
                      <div className="sub">{patient.email}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setActiveUserId(patient.uid)
                          navigate('/')
                        }}
                      >
                        Open
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setLeaveTarget(patient)}>
                        Leave
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Your caregivers" subtitle={caregiversHeading} />
            {caregivers.length === 0 ? (
              <EmptyState
                icon="shield"
                title="No caregivers linked"
                message="A caregiver can see your schedule, prescriptions and alerts, and mark doses as taken."
              />
            ) : (
              <div className="list">
                {caregivers.map((caregiver) => (
                  <div key={caregiver.uid} className="list-row">
                    <Avatar name={caregiver.name} email={caregiver.email} size="sm" />
                    <div className="grow">
                      <div className="title">{caregiver.name}</div>
                      <div className="sub">{caregiver.email}</div>
                    </div>
                    <button
                      type="button"
                      className="mini-btn danger"
                      aria-label={`Remove ${caregiver.name}`}
                      onClick={() => setRemoveTarget(caregiver)}
                    >
                      <Icon name="x" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="card-pad">
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>What caregivers can do</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.8 }}>
              <li>See medicines, schedules, appointments and prescriptions</li>
              <li>Mark a scheduled dose as taken or skipped</li>
              <li>Receive their own copy of alerts in their account</li>
              <li className="muted">Cannot edit or delete clinical records</li>
              <li className="muted">Cannot invite or remove other caregivers</li>
            </ul>
            <div className="alert-box info" style={{ marginTop: 12, fontSize: 11.8 }}>
              <Icon name="shield" size={14} />
              <span>
                Enforced in <span className="mono">firestore.rules</span> with a
                <span className="mono"> get() </span> lookup on the caller’s profile, so the rules
                work even if the UI is bypassed.
              </span>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.name || 'this caregiver'}?`}
        message="They will immediately lose read access to your medicines, appointments, prescriptions and alerts."
        confirmLabel="Remove access"
        loading={busy === 'remove'}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={removeCaregiver}
      />

      <ConfirmDialog
        open={Boolean(leaveTarget)}
        title={`Leave ${leaveTarget?.name || 'this'}'s care circle?`}
        message="You will lose access to their records. They can re-invite you later with a new code."
        confirmLabel="Leave"
        loading={busy === 'leave'}
        onCancel={() => setLeaveTarget(null)}
        onConfirm={leave}
      />
    </>
  )
}
