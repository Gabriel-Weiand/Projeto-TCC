"""
Tela de bloqueio do agente — Overlay fullscreen com login integrado.

Exibe uma tela sobreposta ao desktop que impede o uso do computador
até que o usuário faça login com credenciais válidas e possua uma
alocação ativa.

Para TESTES: a janela é fullscreen e topmost, mas pode ser fechada
pelo Monitor de Tarefas (gnome-system-monitor), Alt+F4, ou matando
o processo Python (kill/pkill).

Compatível com Wayland e X11 (usa -fullscreen em vez de overrideredirect).
"""

import threading
import logging

import customtkinter as ctk

logger = logging.getLogger('agent.screen')

# ── Tema ─────────────────────────────────────────────────────────────
ctk.set_appearance_mode('dark')

# ── Paleta de cores (baseada no frontend web) ────────────────────────
COLORS = {
    'bg': '#08080f',
    'card': '#111119',
    'card_border': '#1a1a2e',
    'accent': '#7c6cf0',
    'accent_hover': '#8e80ff',
    'accent_gradient_start': '#667eea',
    'accent_gradient_end': '#9b6dff',
    'text': '#f0f0f5',
    'text_secondary': '#9595b0',
    'text_muted': '#555570',
    'success': '#34d399',
    'warning': '#fbbf24',
    'danger': '#f87171',
    'info': '#60a5fa',
    'input_bg': '#0d0d18',
    'input_border': '#2a2a40',
}


class ScreenLockOverlay(ctk.CTk):
    """
    Overlay fullscreen que bloqueia o desktop e exibe o formulário de login.

    Métodos principais:
      - show()  — Exibe o overlay (bloqueia desktop)
      - hide()  — Esconde o overlay (libera desktop)
      - update_machine_info(name, status) — Atualiza info da máquina
      - set_status_message(text, color) — Exibe mensagem de status
    """

    def __init__(self):
        super().__init__()

        # ── Callbacks (definidos pelo Agent) ──
        self._on_login_callback = None
        self._on_quick_allocate_callback = None

        # ── Estado ──
        self._visible = False
        self._machine_name = ''
        self._machine_status = ''
        self._quick_allocate_allowed = False
        self._quick_allocate_max_minutes = 0

        # ── Configuração da janela ──
        self.title('Sistema de Laboratórios')
        self.configure(fg_color=COLORS['bg'])

        # Fullscreen compatível com Wayland + X11
        # NÃO usar overrideredirect(True) — no Wayland, popups não recebem foco!
        self.attributes('-fullscreen', True)
        self.attributes('-topmost', True)

        self._build_ui()

        # Inicia escondido
        self.withdraw()

    # ==================================================================
    # Callbacks
    # ==================================================================

    def set_on_login(self, callback):
        """Define callback para login: callback(email, password)."""
        self._on_login_callback = callback

    def set_on_quick_allocate(self, callback):
        """Define callback para quick allocate: callback(email, password, duration_minutes)."""
        self._on_quick_allocate_callback = callback

    # ==================================================================
    # Controle de visibilidade
    # ==================================================================

    def show(self):
        """Exibe o overlay fullscreen."""
        if self._visible:
            return
        self._visible = True

        # Limpa campos
        self._clear_form()
        self._set_status('')

        # Mostra a janela
        self.deiconify()
        self.attributes('-fullscreen', True)
        self.attributes('-topmost', True)
        self.lift()

        # Foca no campo email com delay (necessário em alguns WMs)
        self._schedule_focus()

        # Verificação periódica para recapturar se outra janela roubar foco
        self._start_focus_watchdog()
        logger.info('Overlay de bloqueio exibido')

    def hide(self):
        """Esconde o overlay (libera desktop)."""
        if not self._visible:
            return
        self._visible = False
        self.withdraw()
        logger.info('Overlay de bloqueio escondido — desktop liberado')

    @property
    def is_visible(self) -> bool:
        return self._visible

    # ==================================================================
    # Atualização de informações
    # ==================================================================

    def update_machine_info(self, name: str, status: str):
        """Atualiza nome e status da máquina exibidos no overlay."""
        self._machine_name = name
        self._machine_status = status
        status_display = {
            'available': '🟢 Disponível',
            'occupied': '🔴 Em uso',
            'maintenance': '🟡 Manutenção',
            'offline': '⚫ Offline',
        }.get(status, status)
        self.machine_label.configure(text=f'{name}  •  {status_display}')

    def update_quick_allocate_info(self, allowed: bool, max_minutes: int = 0):
        """Atualiza se quick-allocate está disponível."""
        self._quick_allocate_allowed = allowed
        self._quick_allocate_max_minutes = max_minutes
        if allowed and max_minutes > 0:
            # Gera opções de duração: presets padrão filtrados pelo máximo disponível
            presets = [15, 30, 45, 60, 90, 120]
            options = [f'{p} min' for p in presets if p <= max_minutes]
            # Sempre inclui o máximo se não bater exatamente num preset
            if max_minutes not in presets and max_minutes >= 10:
                options.append(f'{max_minutes} min')
            if not options:
                options = [f'{max_minutes} min']

            self._duration_var.set(options[-1])  # padrão: maior disponível
            self.duration_menu.configure(values=options)

            self.quick_btn.configure(
                state='normal',
                text=f'⚡ ALOCAÇÃO RÁPIDA',
            )
            self.quick_frame.pack(pady=(16, 0))
        else:
            self.quick_frame.pack_forget()

    def set_status_message(self, text: str, color: str = ''):
        """Exibe mensagem de status na tela de login."""
        color = color or COLORS['text_secondary']
        self.after(0, lambda: self.status_label.configure(text=text, text_color=color))

    # ==================================================================
    # Construção da interface
    # ==================================================================

    def _build_ui(self):
        """Monta toda a interface do overlay."""
        # ── Container central ──
        center_frame = ctk.CTkFrame(self, fg_color='transparent')
        center_frame.place(relx=0.5, rely=0.5, anchor='center')

        # ── Card principal ──
        card = ctk.CTkFrame(
            center_frame,
            width=420,
            height=580,
            corner_radius=16,
            fg_color=COLORS['card'],
            border_color=COLORS['card_border'],
            border_width=1,
        )
        card.pack(padx=40, pady=40)
        card.pack_propagate(False)

        # ── Ícone diamante (como no web) ──
        ctk.CTkLabel(
            card,
            text='◆',
            font=ctk.CTkFont(size=40),
            text_color=COLORS['accent'],
        ).pack(pady=(32, 4))

        # ── Título ──
        ctk.CTkLabel(
            card,
            text='Laboratórios',
            font=ctk.CTkFont(family='Inter', size=22, weight='bold'),
            text_color=COLORS['text'],
        ).pack(pady=(0, 4))

        # ── Subtítulo ──
        ctk.CTkLabel(
            card,
            text='Faça login para utilizar este computador',
            font=ctk.CTkFont(family='Inter', size=13),
            text_color=COLORS['text_secondary'],
        ).pack(pady=(0, 8))

        # ── Info da máquina ──
        self.machine_label = ctk.CTkLabel(
            card,
            text='',
            font=ctk.CTkFont(family='Inter', size=12),
            text_color=COLORS['text_muted'],
        )
        self.machine_label.pack(pady=(0, 24))

        # ── Formulário ──
        form_frame = ctk.CTkFrame(card, fg_color='transparent')
        form_frame.pack(padx=40, fill='x')

        # Label Email
        ctk.CTkLabel(
            form_frame,
            text='Email',
            font=ctk.CTkFont(family='Inter', size=12),
            text_color=COLORS['text_secondary'],
            anchor='w',
        ).pack(fill='x', pady=(0, 4))

        # Campo Email
        self.email_entry = ctk.CTkEntry(
            form_frame,
            placeholder_text='seu.email@exemplo.com',
            height=42,
            font=ctk.CTkFont(family='Inter', size=14),
            fg_color=COLORS['input_bg'],
            border_color=COLORS['input_border'],
            border_width=1,
            corner_radius=10,
            text_color=COLORS['text'],
        )
        self.email_entry.pack(fill='x', pady=(0, 12))

        # Label Senha
        ctk.CTkLabel(
            form_frame,
            text='Senha',
            font=ctk.CTkFont(family='Inter', size=12),
            text_color=COLORS['text_secondary'],
            anchor='w',
        ).pack(fill='x', pady=(0, 4))

        # Campo Senha
        self.password_entry = ctk.CTkEntry(
            form_frame,
            placeholder_text='••••••••',
            show='•',
            height=42,
            font=ctk.CTkFont(family='Inter', size=14),
            fg_color=COLORS['input_bg'],
            border_color=COLORS['input_border'],
            border_width=1,
            corner_radius=10,
            text_color=COLORS['text'],
        )
        self.password_entry.pack(fill='x', pady=(0, 24))

        # ── Botão ENTRAR ──
        self.login_btn = ctk.CTkButton(
            form_frame,
            text='ENTRAR',
            height=44,
            font=ctk.CTkFont(family='Inter', size=15, weight='bold'),
            fg_color=COLORS['accent'],
            hover_color=COLORS['accent_hover'],
            corner_radius=10,
            command=self._on_login_click,
        )
        self.login_btn.pack(fill='x')

        # ── Quick Allocate (inicialmente escondido) ──
        self.quick_frame = ctk.CTkFrame(form_frame, fg_color='transparent')
        # NÃO faz pack aqui — será exibido quando permitido

        # Seletor de duração
        duration_row = ctk.CTkFrame(self.quick_frame, fg_color='transparent')
        duration_row.pack(fill='x', pady=(0, 8))

        ctk.CTkLabel(
            duration_row,
            text='Duração:',
            font=ctk.CTkFont(family='Inter', size=12),
            text_color=COLORS['text_secondary'],
        ).pack(side='left', padx=(0, 8))

        self._duration_var = ctk.StringVar(value='60 min')
        self.duration_menu = ctk.CTkOptionMenu(
            duration_row,
            variable=self._duration_var,
            values=['15 min', '30 min', '60 min'],
            width=120,
            height=32,
            font=ctk.CTkFont(family='Inter', size=12),
            fg_color=COLORS['input_bg'],
            button_color=COLORS['accent'],
            button_hover_color=COLORS['accent_hover'],
            dropdown_fg_color=COLORS['card'],
            dropdown_hover_color=COLORS['card_border'],
            text_color=COLORS['text'],
        )
        self.duration_menu.pack(side='left')

        self.quick_btn = ctk.CTkButton(
            self.quick_frame,
            text='⚡ ALOCAÇÃO RÁPIDA',
            height=40,
            font=ctk.CTkFont(family='Inter', size=13, weight='bold'),
            fg_color='transparent',
            hover_color=COLORS['card_border'],
            border_color=COLORS['accent'],
            border_width=1,
            corner_radius=10,
            text_color=COLORS['accent'],
            command=self._on_quick_allocate_click,
        )
        self.quick_btn.pack(fill='x')

        # ── Status / Feedback ──
        self.status_label = ctk.CTkLabel(
            card,
            text='',
            font=ctk.CTkFont(family='Inter', size=13),
            text_color=COLORS['text_secondary'],
            wraplength=340,
        )
        self.status_label.pack(pady=(16, 0))

        # ── Atalhos de teclado ──
        self.bind('<Return>', lambda _: self._on_login_click())
        self.email_entry.bind('<Tab>', lambda _: self._focus_password())

    # ==================================================================
    # Ações
    # ==================================================================

    def _on_login_click(self):
        """Valida campos e dispara callback de login."""
        email = self.email_entry.get().strip()
        password = self.password_entry.get().strip()

        if not email or not password:
            self._set_status('Preencha todos os campos.', COLORS['warning'])
            return

        self.login_btn.configure(state='disabled', text='Validando...')
        self._set_status('Conectando ao servidor...', COLORS['text_secondary'])

        if self._on_login_callback:
            t = threading.Thread(
                target=self._on_login_callback, args=(email, password), daemon=True
            )
            t.start()

    def _on_quick_allocate_click(self):
        """Valida campos e dispara callback de quick allocate."""
        email = self.email_entry.get().strip()
        password = self.password_entry.get().strip()

        if not email or not password:
            self._set_status('Preencha email e senha para alocação rápida.', COLORS['warning'])
            return

        # Extrai duração selecionada (ex: "60 min" → 60)
        try:
            selected_minutes = int(self._duration_var.get().split()[0])
        except (ValueError, IndexError):
            selected_minutes = self._quick_allocate_max_minutes

        self.quick_btn.configure(state='disabled', text='Criando alocação...')
        self._set_status('Conectando ao servidor...', COLORS['text_secondary'])

        if self._on_quick_allocate_callback:
            t = threading.Thread(
                target=self._on_quick_allocate_callback,
                args=(email, password, selected_minutes),
                daemon=True,
            )
            t.start()

    # ==================================================================
    # Helpers internos
    # ==================================================================

    def _schedule_focus(self):
        """Agenda foco no campo email — sem tocar no foco da janela raiz."""
        def _try_focus(attempts=5):
            if not self._visible or attempts <= 0:
                return
            try:
                self.email_entry.focus_set()
            except Exception:
                pass
            # Se o entry ainda não respondeu, tenta de novo
            if attempts > 1:
                self.after(300, lambda: _try_focus(attempts - 1))
        # Delay inicial maior para dar tempo ao WM processar a janela
        self.after(200, _try_focus)

    def _focus_password(self):
        """Move foco para o campo senha (atalho Tab)."""
        self.password_entry.focus_set()
        return 'break'

    def _start_focus_watchdog(self):
        """Verifica periodicamente se OUTRA JANELA roubou foco do overlay."""
        def _check():
            if not self._visible:
                return
            try:
                # Só age se o foco saiu totalmente da nossa janela
                focused = self.focus_get()
                if focused is None:
                    # Foco foi para fora do app — traz de volta
                    self.lift()
                    self.attributes('-topmost', True)
                    self.email_entry.focus_set()
            except Exception:
                pass
            if self._visible:
                self.after(2000, _check)
        self.after(3000, _check)

    def _set_status(self, text: str, color: str = ''):
        color = color or COLORS['text_secondary']
        self.status_label.configure(text=text, text_color=color)

    def _clear_form(self):
        self.email_entry.delete(0, 'end')
        self.password_entry.delete(0, 'end')
        self.login_btn.configure(state='normal', text='ENTRAR')
        self.quick_btn.configure(state='normal')

    def reset_buttons(self):
        """Restaura estado dos botões (chamado pelo Agent após resposta do servidor)."""
        self.after(0, lambda: self.login_btn.configure(state='normal', text='ENTRAR'))
        self.after(0, lambda: self.quick_btn.configure(state='normal'))

    def show_warning_popup(self, minutes: int):
        """Exibe popup de aviso flutuante sobre o fim da sessão."""
        def _show():
            popup = ctk.CTkToplevel(self)
            popup.title('')
            popup.attributes('-topmost', True)
            popup.configure(fg_color=COLORS['bg'])
            popup.overrideredirect(True)

            # Centraliza no topo da tela
            popup.update_idletasks()
            sw = popup.winfo_screenwidth()
            pw = 420
            ph = 120
            x = (sw - pw) // 2
            popup.geometry(f'{pw}x{ph}+{x}+40')

            # Cor do borde conforme urgência
            border_color = COLORS['warning'] if minutes > 1 else COLORS['danger']

            frame = ctk.CTkFrame(
                popup,
                fg_color=COLORS['card'],
                border_color=border_color,
                border_width=2,
                corner_radius=12,
            )
            frame.pack(fill='both', expand=True, padx=2, pady=2)

            icon = '⏰' if minutes > 1 else '⚠️'
            ctk.CTkLabel(
                frame,
                text=f'{icon}  Sessão encerrando em {minutes} minuto{"s" if minutes != 1 else ""}!',
                font=ctk.CTkFont(family='Inter', size=16, weight='bold'),
                text_color=COLORS['warning'] if minutes > 1 else COLORS['danger'],
            ).pack(pady=(18, 4))

            ctk.CTkLabel(
                frame,
                text='Salve seu trabalho antes do encerramento.',
                font=ctk.CTkFont(family='Inter', size=12),
                text_color=COLORS['text_secondary'],
            ).pack()

            # Fecha automaticamente após 8 segundos
            popup.after(8000, popup.destroy)

        self.after(0, _show)



def is_session_locked() -> bool:
    """Verifica se a sessão atual está bloqueada."""
    try:
        result = subprocess.run(
            ['loginctl', 'show-session', 'self', '-p', 'LockedHint'],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return 'yes' in result.stdout.lower()
    except Exception:
        return False
