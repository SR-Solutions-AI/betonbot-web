'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Trash2, UserPlus, ChevronDown, Check } from 'lucide-react'
import { apiFetch } from '../../../lib/supabaseClient'

type OrgMember = {
  id: string
  email: string | null
  full_name: string | null
  role: string | null
  created_at: string
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function RoleDropdown({
  value,
  onChange,
  id,
}: {
  value: 'user' | 'org_leader'
  onChange: (v: 'user' | 'org_leader') => void
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 240 })

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const MIN_W = 240
    const MENU_H = 120
    const GAP = 6
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect()
      const width = Math.max(rect.width, MIN_W)
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = Math.max(GAP, Math.min(rect.left, vw - width - GAP))
      const wouldOverflowBottom = rect.bottom + GAP + MENU_H > vh
      const top = wouldOverflowBottom ? Math.max(GAP, rect.top - GAP - MENU_H) : rect.bottom + GAP
      setPos({ top, left, width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    if (open) document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [open])

  const label = value === 'org_leader' ? 'Organization Leader' : 'User'

  return (
    <div ref={triggerRef} className="relative" id={id}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 sun-input text-sm py-2.5 px-3 rounded-xl bg-white/5 border border-white/15 text-left text-white hover:border-white/25 focus:border-[#E5B800]/50 focus:ring-2 focus:ring-[#E5B800]/20"
      >
        <span>{label}</span>
        <ChevronDown size={16} className={`text-sand/50 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {typeof document !== 'undefined' &&
        open &&
        createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-9998 rounded-xl bg-coffee-850 border border-white/20 shadow-xl shadow-black/40 overflow-hidden py-1.5"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {(['user', 'org_leader'] as const).map((opt) => {
              const isSelected = value === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    onChange(opt)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                    isSelected ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {isSelected ? <Check size={16} className="shrink-0" /> : <span className="w-5" />}
                  {opt === 'org_leader' ? 'Organization Leader' : 'User'}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}

export default function OrganisationSettingsPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addEmail, setAddEmail] = useState('')
  const [addFullName, setAddFullName] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addRole, setAddRole] = useState<'user' | 'org_leader'>('user')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [editFullName, setEditFullName] = useState('')
  const [editRole, setEditRole] = useState<'user' | 'org_leader'>('user')
  const [editPassword, setEditPassword] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = await apiFetch('/me') as { user?: { role?: string; can_manage_org?: boolean } }
        const role = me?.user?.role
        const canManageOrg = me?.user?.can_manage_org === true
        const canSeeOrgSettings = role === 'org_leader' || canManageOrg
        if (!cancelled) {
          setIsAdmin(canSeeOrgSettings)
          if (!canSeeOrgSettings) {
            router.replace('/dashboard')
            return
          }
        }

        const membersRes = await apiFetch('/organisation/members').catch((): { items: OrgMember[] } => ({ items: [] })) as { items: OrgMember[] }
        if (!cancelled && Array.isArray(membersRes.items)) {
          setMembers(membersRes.items)
        }
      } catch {
        if (!cancelled) router.replace('/dashboard')
      } finally {
        if (!cancelled) {
          setReady(true)
          setMembersLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [router])

  const handleAddMember = async () => {
    setAddError(null)
    if (!addEmail.trim() || !addPassword.trim()) {
      setAddError('E-Mail und Passwort sind erforderlich.')
      return
    }
    if (addPassword.length < 6) {
      setAddError('Passwort muss mindestens 6 Zeichen haben.')
      return
    }
    setAddSaving(true)
    try {
      await apiFetch('/organisation/members', {
        method: 'POST',
        body: JSON.stringify({
          email: addEmail.trim(),
          full_name: addFullName.trim() || addEmail.trim(),
          password: addPassword,
          role: addRole,
        }),
      })
      const res = await apiFetch('/organisation/members') as { items: OrgMember[] }
      setMembers(res.items ?? [])
      setAddOpen(false)
      setAddEmail('')
      setAddFullName('')
      setAddPassword('')
      setAddRole('user')
    } catch (error: unknown) {
      setAddError(getErrorMessage(error, 'Fehler beim Anlegen des Benutzers.'))
    } finally {
      setAddSaving(false)
    }
  }

  const handleUpdateMember = async (id: string) => {
    setEditSaving(true)
    try {
      await apiFetch(`/organisation/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: editFullName.trim() || undefined,
          role: editRole,
          ...(editPassword.trim().length >= 6 ? { password: editPassword } : {}),
        }),
      })
      const res = await apiFetch('/organisation/members') as { items: OrgMember[] }
      setMembers(res.items ?? [])
      setEditingId(null)
      setEditFullName('')
      setEditRole('user')
      setEditPassword('')
    } catch {
      // keep form open on error
    } finally {
      setEditSaving(false)
    }
  }

  const handleDeleteMember = async (id: string) => {
    setDeleteSaving(true)
    try {
      await apiFetch(`/organisation/members/${id}`, { method: 'DELETE' })
      setMembers((prev) => prev.filter((m) => m.id !== id))
      setDeleteConfirmId(null)
    } catch {
      // ignore
    } finally {
      setDeleteSaving(false)
    }
  }

  if (!ready || !isAdmin) return null

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
.preisdatenbank-scroll {
  overflow-y: scroll !important;
  overflow-x: auto !important;
  scrollbar-width: thin !important;
  scrollbar-color: #E5B800 transparent !important;
}
.preisdatenbank-scroll::-webkit-scrollbar {
  width: 10px !important;
  height: 10px !important;
}
.preisdatenbank-scroll::-webkit-scrollbar-track {
  background: transparent !important;
}
.preisdatenbank-scroll::-webkit-scrollbar-thumb {
  background: #E5B800 !important;
  border-radius: 9999px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
  min-height: 40px !important;
}
`,
        }}
      />
      <div className="h-full flex flex-col min-h-0">
        <div className="preisdatenbank-scroll px-4 py-4 md:px-5 md:py-5 w-full flex-1 min-h-0 overflow-y-auto">
          <div className="w-full max-w-4xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 text-center">Organisationseinstellungen</h1>
            <p className="text-sand/80 text-base mb-6 text-center">Benutzer der Organisation verwalten.</p>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 md:p-6">
              <h2 className="text-xl font-bold text-[#E5B800] mb-1">Benutzer der Organisation</h2>
              <p className="text-white/80 text-sm mb-4">E-Mail, Name und Rolle verwalten. Admins können alle Einstellungen ändern.</p>
              {membersLoading ? (
                <div className="flex items-center gap-2 text-sand/80"><Loader2 size={18} className="animate-spin" /> Laden…</div>
              ) : (
                <div className="space-y-3">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-4 py-2 border-b border-white/10 last:border-0">
                      {editingId === m.id ? (
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-medium text-sand/70 uppercase tracking-wider">Name</label>
                            <input type="text" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} className="sun-input text-sm mt-1" placeholder="Name" />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-sand/70 uppercase tracking-wider">Rolle</label>
                            <div className="mt-1">
                              <RoleDropdown value={editRole} onChange={setEditRole} />
                            </div>
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs font-medium text-sand/70 uppercase tracking-wider">Passwort</label>
                            <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} className="sun-input text-sm mt-1 w-full" placeholder="Neues Passwort (leer = unverändert)" />
                          </div>
                          <div className="col-span-2 flex gap-2">
                            <button type="button" disabled={editSaving} onClick={() => handleUpdateMember(m.id)} className="px-3 py-1.5 rounded-lg bg-[#E5B800] text-white text-sm font-medium">
                              {editSaving ? <Loader2 size={14} className="animate-spin" /> : 'Speichern'}
                            </button>
                            <button type="button" onClick={() => { setEditingId(null); setEditPassword('') }} className="px-3 py-1.5 rounded-lg border border-white/20 text-sand/80 text-sm">Abbrechen</button>
                          </div>
                        </div>
                      ) : deleteConfirmId === m.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <span className="text-sm text-yellow-200">Wirklich löschen?</span>
                          <button type="button" disabled={deleteSaving} onClick={() => handleDeleteMember(m.id)} className="px-2 py-1 rounded bg-red-600 text-white text-sm">
                            {deleteSaving ? <Loader2 size={14} className="animate-spin" /> : 'Ja'}
                          </button>
                          <button type="button" onClick={() => setDeleteConfirmId(null)} className="px-2 py-1 rounded border border-white/20 text-sm">Nein</button>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <div className="font-medium text-white truncate">{m.full_name || m.email || '—'}</div>
                            <div className="text-sm text-sand/70 truncate">{m.email}</div>
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs bg-white/10 text-sand/90">{m.role === 'org_leader' || m.role === 'admin' ? 'Organization Leader' : 'User'}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(m.id)
                                setEditFullName(m.full_name || '')
                                setEditRole((m.role === 'org_leader' || m.role === 'admin' ? 'org_leader' : 'user') as 'user' | 'org_leader')
                                setEditPassword('')
                              }}
                              className="p-2 rounded text-sand/70 hover:text-[#E5B800]"
                              title="Bearbeiten"
                            >
                              <Pencil size={16} />
                            </button>
                            <button type="button" onClick={() => setDeleteConfirmId(m.id)} className="p-2 rounded text-sand/70 hover:text-red-400" title="Löschen">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}

                  {addOpen ? (
                    <div className="pt-4 border-t border-white/10 space-y-3">
                      <div>
                        <label className="text-xs font-medium text-sand/70 uppercase tracking-wider">E-Mail</label>
                        <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} className="sun-input w-full mt-1" placeholder="E-Mail" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-sand/70 uppercase tracking-wider">Name</label>
                        <input type="text" value={addFullName} onChange={(e) => setAddFullName(e.target.value)} className="sun-input w-full mt-1" placeholder="Name (Vorname Nachname)" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-sand/70 uppercase tracking-wider">Passwort</label>
                        <input type="password" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} className="sun-input w-full mt-1" placeholder="Passwort (min. 6 Zeichen)" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-sand/70 uppercase tracking-wider">Rolle</label>
                        <div className="mt-1">
                          <RoleDropdown value={addRole} onChange={setAddRole} />
                        </div>
                      </div>
                      {addError && <p className="text-yellow-400 text-sm">{addError}</p>}
                      <div className="flex gap-2">
                        <button type="button" disabled={addSaving} onClick={handleAddMember} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#E5B800] text-white font-medium">
                          {addSaving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                          Benutzer anlegen
                        </button>
                        <button type="button" onClick={() => { setAddOpen(false); setAddError(null) }} className="px-3 py-2 rounded-lg border border-white/20 text-sand/80">Abbrechen</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-2 py-2 text-[#E5B800] hover:underline text-sm">
                      <UserPlus size={16} /> Benutzer hinzufügen
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
