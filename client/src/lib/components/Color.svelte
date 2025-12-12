<script lang="ts">
  import { tick, onMount, afterUpdate } from 'svelte';
  import type { Color as ColorClass } from '../../../../dataframe.js';
  import "bootstrap-icons/font/bootstrap-icons.css";

  export let socket: WebSocket;
  export let color: ColorClass;
  export let selectedColor: ColorClass | null;
  export let selectColor: (c: ColorClass) => void;
  export let removeable: boolean = true;

  // 전역 변수로 focus가 필요한 color id를 저장
  let focusColorId: number | null = null;
  if (typeof window !== 'undefined') {
    (window as any).__focusColorId = (window as any).__focusColorId || null;
  }

  function select() {
    selectColor(color);
  }

  function renameColor() {
    const newName = prompt("새로운 색상 이름을 입력하세요:", color.name);
    if (!newName) return;
    const newColor = prompt("새로운 색상 값(헥스)을 입력하세요:", color.color);
    if (!newColor) return;

    socket.send(`renamecolor\t${color.id}\t${newName}`);
    socket.send(`changecolor\t${color.id}\t${newColor}`);
  }

  function removeColor() {
    if (!confirm(`정말로 색상 "${color.name}"을 삭제하시겠습니까?`)) return;
    socket.send(`removecolor\t${color.id}`);
  }

  function toggleLock() {
    socket.send(`setcolorlock\t${color.id}\t${color.locked ? 0 : 1}`);
  }

  function isSelected(): boolean {
    if (!selectedColor) return false;

    return selectedColor.id === color.id;
  }

  let inputEl: HTMLInputElement | null = null;

  async function onFilterInputKeypress(event: KeyboardEvent) {
    // 숫자, Enter, Backspace, Delete, Arrow keys만 허용
    if (!/^\d$/.test(event.key) && !['Enter', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.key)) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (!inputEl) return;
      const value = inputEl.value;
      socket.send(`addcolorfilter\t${color.id}\t${value}`);
      inputEl.value = "";
      // 전역 변수에 현재 color id를 저장
      if (typeof window !== 'undefined') {
        (window as any).__focusColorId = color.id;
      }
    }
  }

  onMount(() => {
    // 컴포넌트가 마운트될 때 이 color에 focus가 필요한지 확인
    if (typeof window !== 'undefined' && (window as any).__focusColorId === color.id) {
      setTimeout(() => {
        inputEl?.focus();
        (window as any).__focusColorId = null;
      }, 0);
    }
  });
</script>

<div class="color-item" class:selected={isSelected()}>
  <div class="color-name">
    <div class="color-info">
      <button on:click={select} on:dblclick={renameColor} class="color-button" style="color: {color.color};">
        &#x25CF; {color.name}
      </button>
      <div class="color-id">
        #{color.id}
      </div>
      <div class="color-filters">
        {#each color.filterAts as filterAt}
          <button on:click={() => {
            socket.send(`removecolorfilter\t${color.id}\t${filterAt}`);
          }}>{filterAt}</button>,
        {/each}
        <input type="text" bind:this={inputEl} on:keypress={onFilterInputKeypress}>
      </div>
    </div>
    <div class="color-actions">
    <button on:click={toggleLock} class="button" class:locked={color.locked} aria-label="lock">
      <i class="bi bi-lock"></i>
    </button>
    {#if removeable}
      <button on:click={removeColor} class="button" aria-label="rename">
        <i class="bi bi-trash"></i>
      </button>
    {/if}
    </div>
  </div>
</div>

<style>
  .color-item {
    margin: 4px 0;
    padding-left: 8px;
    border-left: 4px solid #666666;
    transition: all 0.2s;
  }

  .selected {
    border-left-width: 16px;
  }

  button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  button:hover {
    background-color: #444444;
  }

  .color-button {
    font-size: 14px;
    text-shadow: 0 0 0 #f7f7f9;
  }

  .button {
    float: right;
  }

  .locked {
    color: #ffcc00;
  }

  .color-name {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .color-info {
    flex: 1;
  }

  .color-id {
    font-size: 10px;
    color: #aaaaaa;
  }

  .color-filters input[type="text"] {
    width: 20px;
    background: none;
    border: none;
    color: #aaaaaa;
    font-size: 10px;
    border-bottom: 0.5px dashed #aaaaaa;
    transition: all 0.2s;
  }

  .color-filters input[type="text"]:focus {
    outline: none;
    border-bottom: 0.5px solid #ffffff;
  }
</style>
