<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { v4 as uuidv4 } from 'uuid';

	import { goto } from '$app/navigation';
	import {
		user,
		chats,
		settings,
		showSettings,
		chatId,
		tags,
		showSidebar,
		mobile,
		showArchivedChats,
		pinnedChats,
		scrollPaginationEnabled,
		currentChatPage,
		temporaryChatEnabled,
		channels,
		socket,
		config,
		isApp
	} from '$lib/stores';
	import { onMount, getContext, tick, onDestroy } from 'svelte';

	const i18n = getContext('i18n');

	import {
		deleteChatById,
		getChatList,
		getAllTags,
		getChatListBySearchText,
		createNewChat,
		getPinnedChatList,
		toggleChatPinnedStatusById,
		getChatPinnedStatusById,
		getChatById,
		updateChatFolderIdById,
		importChat
	} from '$lib/apis/chats';
	import { createNewFolder, getFolders, updateFolderParentIdById } from '$lib/apis/folders';
	import { WEBUI_BASE_URL } from '$lib/constants';

	import ArchivedChatsModal from './Sidebar/ArchivedChatsModal.svelte';
	import UserMenu from './Sidebar/UserMenu.svelte';
	import ChatItem from './Sidebar/ChatItem.svelte';
	import Spinner from '../common/Spinner.svelte';
	import Loader from '../common/Loader.svelte';
	import AddFilesPlaceholder from '../AddFilesPlaceholder.svelte';
	import SearchInput from './Sidebar/SearchInput.svelte';
	import Folder from '../common/Folder.svelte';
	import Plus from '../icons/Plus.svelte';
	import Tooltip from '../common/Tooltip.svelte';
	import Folders from './Sidebar/Folders.svelte';
	import { getChannels, createNewChannel } from '$lib/apis/channels';
	import ChannelModal from './Sidebar/ChannelModal.svelte';
	import ChannelItem from './Sidebar/ChannelItem.svelte';
	import PencilSquare from '../icons/PencilSquare.svelte';
	import Home from '../icons/Home.svelte';

	const BREAKPOINT = 768;

	let navElement;
	let search = '';

	let shiftKey = false;

	let selectedChatId = null;
	let showDropdown = false;
	let showPinnedChat = true;

	let showCreateChannel = false;

	// Pagination variables
	let chatListLoading = false;
	let allChatsLoaded = false;

	let folders = {};

	const initFolders = async () => {
		const folderList = await getFolders(localStorage.token).catch((error) => {
			toast.error(`${error}`);
			return [];
		});

		folders = {};

		// First pass: Initialize all folder entries
		for (const folder of folderList) {
			// Ensure folder is added to folders with its data
			folders[folder.id] = { ...(folders[folder.id] || {}), ...folder };
		}

		// Second pass: Tie child folders to their parents
		for (const folder of folderList) {
			if (folder.parent_id) {
				// Ensure the parent folder is initialized if it doesn't exist
				if (!folders[folder.parent_id]) {
					folders[folder.parent_id] = {}; // Create a placeholder if not already present
				}

				// Initialize childrenIds array if it doesn't exist and add the current folder id
				folders[folder.parent_id].childrenIds = folders[folder.parent_id].childrenIds
					? [...folders[folder.parent_id].childrenIds, folder.id]
					: [folder.id];

				// Sort the children by updated_at field
				folders[folder.parent_id].childrenIds.sort((a, b) => {
					return folders[b].updated_at - folders[a].updated_at;
				});
			}
		}
	};

	const createFolder = async (name = 'Untitled') => {
		if (name === '') {
			toast.error($i18n.t('Folder name cannot be empty.'));
			return;
		}

		const rootFolders = Object.values(folders).filter((folder) => folder.parent_id === null);
		if (rootFolders.find((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
			// If a folder with the same name already exists, append a number to the name
			let i = 1;
			while (
				rootFolders.find((folder) => folder.name.toLowerCase() === `${name} ${i}`.toLowerCase())
			) {
				i++;
			}

			name = `${name} ${i}`;
		}

		// Add a dummy folder to the list to show the user that the folder is being created
		const tempId = uuidv4();
		folders = {
			...folders,
			tempId: {
				id: tempId,
				name: name,
				created_at: Date.now(),
				updated_at: Date.now()
			}
		};

		const res = await createNewFolder(localStorage.token, name).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			await initFolders();
		}
	};

	const initChannels = async () => {
		await channels.set(await getChannels(localStorage.token));
	};

	const initChatList = async () => {
		// Reset pagination variables
		tags.set(await getAllTags(localStorage.token));
		pinnedChats.set(await getPinnedChatList(localStorage.token));
		initFolders();

		currentChatPage.set(1);
		allChatsLoaded = false;

		if (search) {
			await chats.set(await getChatListBySearchText(localStorage.token, search, $currentChatPage));
		} else {
			await chats.set(await getChatList(localStorage.token, $currentChatPage));
		}

		// Enable pagination
		scrollPaginationEnabled.set(true);
	};

	const loadMoreChats = async () => {
		chatListLoading = true;

		currentChatPage.set($currentChatPage + 1);

		let newChatList = [];

		if (search) {
			newChatList = await getChatListBySearchText(localStorage.token, search, $currentChatPage);
		} else {
			newChatList = await getChatList(localStorage.token, $currentChatPage);
		}

		// once the bottom of the list has been reached (no results) there is no need to continue querying
		allChatsLoaded = newChatList.length === 0;
		await chats.set([...($chats ? $chats : []), ...newChatList]);

		chatListLoading = false;
	};

	let searchDebounceTimeout;

	const searchDebounceHandler = async () => {
		console.log('search', search);
		chats.set(null);

		if (searchDebounceTimeout) {
			clearTimeout(searchDebounceTimeout);
		}

		if (search === '') {
			await initChatList();
			return;
		} else {
			searchDebounceTimeout = setTimeout(async () => {
				allChatsLoaded = false;
				currentChatPage.set(1);
				await chats.set(await getChatListBySearchText(localStorage.token, search));

				if ($chats.length === 0) {
					tags.set(await getAllTags(localStorage.token));
				}
			}, 1000);
		}
	};

	const importChatHandler = async (items, pinned = false, folderId = null) => {
		console.log('importChatHandler', items, pinned, folderId);
		for (const item of items) {
			console.log(item);
			if (item.chat) {
				await importChat(localStorage.token, item.chat, item?.meta ?? {}, pinned, folderId);
			}
		}

		initChatList();
	};

	const inputFilesHandler = async (files) => {
		console.log(files);

		for (const file of files) {
			const reader = new FileReader();
			reader.onload = async (e) => {
				const content = e.target.result;

				try {
					const chatItems = JSON.parse(content);
					importChatHandler(chatItems);
				} catch {
					toast.error($i18n.t(`Invalid file format.`));
				}
			};

			reader.readAsText(file);
		}
	};

	const tagEventHandler = async (type, tagName, chatId) => {
		console.log(type, tagName, chatId);
		if (type === 'delete') {
			initChatList();
		} else if (type === 'add') {
			initChatList();
		}
	};

	let draggedOver = false;

	const onDragOver = (e) => {
		e.preventDefault();

		// Check if a file is being draggedOver.
		if (e.dataTransfer?.types?.includes('Files')) {
			draggedOver = true;
		} else {
			draggedOver = false;
		}
	};

	const onDragLeave = () => {
		draggedOver = false;
	};

	const onDrop = async (e) => {
		e.preventDefault();
		console.log(e); // Log the drop event

		// Perform file drop check and handle it accordingly
		if (e.dataTransfer?.files) {
			const inputFiles = Array.from(e.dataTransfer?.files);

			if (inputFiles && inputFiles.length > 0) {
				console.log(inputFiles); // Log the dropped files
				inputFilesHandler(inputFiles); // Handle the dropped files
			}
		}

		draggedOver = false; // Reset draggedOver status after drop
	};

	let touchstart;
	let touchend;

	function checkDirection() {
		const screenWidth = window.innerWidth;
		const swipeDistance = Math.abs(touchend.screenX - touchstart.screenX);
		if (touchstart.clientX < 40 && swipeDistance >= screenWidth / 8) {
			if (touchend.screenX < touchstart.screenX) {
				showSidebar.set(false);
			}
			if (touchend.screenX > touchstart.screenX) {
				showSidebar.set(true);
			}
		}
	}

	const onTouchStart = (e) => {
		touchstart = e.changedTouches[0];
		console.log(touchstart.clientX);
	};

	const onTouchEnd = (e) => {
		touchend = e.changedTouches[0];
		checkDirection();
	};

	const onKeyDown = (e) => {
		if (e.key === 'Shift') {
			shiftKey = true;
		}
	};

	const onKeyUp = (e) => {
		if (e.key === 'Shift') {
			shiftKey = false;
		}
	};

	const onFocus = () => {};

	const onBlur = () => {
		shiftKey = false;
		selectedChatId = null;
	};

	onMount(async () => {
		showPinnedChat = localStorage?.showPinnedChat ? localStorage.showPinnedChat === 'true' : true;

		mobile.subscribe((value) => {
			if ($showSidebar && value) {
				showSidebar.set(false);
			}

			if ($showSidebar && !value) {
				const navElement = document.getElementsByTagName('nav')[0];
				if (navElement) {
					navElement.style['-webkit-app-region'] = 'drag';
				}
			}

			if (!$showSidebar && !value) {
				showSidebar.set(true);
			}
		});

		showSidebar.set(!$mobile ? localStorage.sidebar === 'true' : false);
		showSidebar.subscribe((value) => {
			localStorage.sidebar = value;

			// nav element is not available on the first render
			const navElement = document.getElementsByTagName('nav')[0];

			if (navElement) {
				if ($mobile) {
					if (!value) {
						navElement.style['-webkit-app-region'] = 'drag';
					} else {
						navElement.style['-webkit-app-region'] = 'no-drag';
					}
				} else {
					navElement.style['-webkit-app-region'] = 'drag';
				}
			}
		});

		await initChannels();
		await initChatList();

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);

		window.addEventListener('touchstart', onTouchStart);
		window.addEventListener('touchend', onTouchEnd);

		window.addEventListener('focus', onFocus);
		window.addEventListener('blur-sm', onBlur);

		const dropZone = document.getElementById('sidebar');

		dropZone?.addEventListener('dragover', onDragOver);
		dropZone?.addEventListener('drop', onDrop);
		dropZone?.addEventListener('dragleave', onDragLeave);
	});

	onDestroy(() => {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);

		window.removeEventListener('touchstart', onTouchStart);
		window.removeEventListener('touchend', onTouchEnd);

		window.removeEventListener('focus', onFocus);
		window.removeEventListener('blur-sm', onBlur);

		const dropZone = document.getElementById('sidebar');

		dropZone?.removeEventListener('dragover', onDragOver);
		dropZone?.removeEventListener('drop', onDrop);
		dropZone?.removeEventListener('dragleave', onDragLeave);
	});
</script>

<ArchivedChatsModal
	bind:show={$showArchivedChats}
	on:change={async () => {
		await initChatList();
	}}
/>

<ChannelModal
	bind:show={showCreateChannel}
	onSubmit={async ({ name, access_control }) => {
		const res = await createNewChannel(localStorage.token, {
			name: name,
			access_control: access_control
		}).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			$socket.emit('join-channels', { auth: { token: $user.token } });
			await initChannels();
			showCreateChannel = false;
		}
	}}
/>

<!-- svelte-ignore a11y-no-static-element-interactions -->

{#if $showSidebar}
	<div
		class=" {$isApp
			? ' ml-[4.5rem] md:ml-0'
			: ''} fixed md:hidden z-40 top-0 right-0 left-0 bottom-0 bg-black/60 w-full min-h-screen h-screen flex justify-center overflow-hidden overscroll-contain"
		on:mousedown={() => {
			showSidebar.set(!$showSidebar);
		}}
	/>
{/if}

<div
	bind:this={navElement}
	id="sidebar"
	class="h-screen max-h-[100dvh] min-h-screen select-none {$showSidebar
		? 'md:relative w-[260px] max-w-[260px]'
		: '-translate-x-[260px] w-[0px]'} {$isApp
		? `ml-[4.5rem] md:ml-0 `
		: 'transition-width duration-200 ease-in-out'}  shrink-0 bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-200 text-sm fixed z-50 top-0 left-0 overflow-x-hidden
        "
	data-state={$showSidebar}
>
	<div
		class="py-2 my-auto flex flex-col justify-between h-screen max-h-[100dvh] w-[260px] overflow-x-hidden z-50 {$showSidebar
			? ''
			: 'invisible'}"
	>
		<div class="px-1.5 flex justify-between space-x-1 text-gray-600 dark:text-gray-400">
			<button
				class=" cursor-pointer p-[7px] flex rounded-xl hover:bg-gray-100 dark:hover:bg-gray-900 transition"
				on:click={() => {
					showSidebar.set(!$showSidebar);
				}}
			>
				<div class=" m-auto self-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="2"
						stroke="currentColor"
						class="size-5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
						/>
					</svg>
				</div>
			</button>

			<a
				id="sidebar-new-chat-button"
				class="flex justify-between items-center flex-1 rounded-lg px-2 py-1 h-full text-right hover:bg-gray-100 dark:hover:bg-gray-900 transition no-drag-region"
				href="/"
				draggable="false"
				on:click={async () => {
					selectedChatId = null;
					await goto('/');
					const newChatButton = document.getElementById('new-chat-button');
					setTimeout(() => {
						newChatButton?.click();
						if ($mobile) {
							showSidebar.set(false);
						}
					}, 0);
				}}
			>
				<div class="flex items-center">
					<div class="self-center mx-1.5">
						<img
							crossorigin="anonymous"
							src="{WEBUI_BASE_URL}/static/favicon.png"
							class=" size-8 -translate-x-1.5 rounded-full"
							alt="logo"
						/>
					</div>
					<div class=" self-center font-medium text-base text-gray-850 dark:text-white font-primary" style="padding:4px 10px;">
						{$i18n.t('New Chat')}
					</div>
				</div>

				<div>
					<PencilSquare className=" size-5" strokeWidth="2" />
				</div>
			</a>
		</div>

		<!-- {#if $user?.role === 'admin'}
			<div class="px-1.5 flex justify-center text-gray-800 dark:text-gray-200">
				<a
					class="grow flex items-center space-x-3 rounded-lg px-2 py-[7px] hover:bg-gray-100 dark:hover:bg-gray-900 transition"
					href="/home"
					on:click={() => {
						selectedChatId = null;
						chatId.set('');

						if ($mobile) {
							showSidebar.set(false);
						}
					}}
					draggable="false"
				>
					<div class="self-center">
						<Home strokeWidth="2" className="size-[1.1rem]" />
					</div>

					<div class="flex self-center translate-y-[0.5px]">
						<div class=" self-center font-medium text-sm font-primary">{$i18n.t('Home')}</div>
					</div>
				</a>
			</div>
		{/if} -->

		{#if $user?.role === 'admin' || $user?.permissions?.workspace?.models || $user?.permissions?.workspace?.knowledge || $user?.permissions?.workspace?.prompts || $user?.permissions?.workspace?.tools}
			<div class="px-1.5 flex justify-center text-gray-800 dark:text-gray-200">
				<a
					class="grow flex items-center space-x-3 rounded-lg px-2 py-[7px] hover:bg-gray-100 dark:hover:bg-gray-900 transition"
					href="/workspace"
					on:click={() => {
						selectedChatId = null;
						chatId.set('');

						if ($mobile) {
							showSidebar.set(false);
						}
					}}
					draggable="false"
				>
					<div class="self-center">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
							class="size-[1.1rem]"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z"
							/>
						</svg>
					</div>

					<div class="flex self-center translate-y-[0.5px]">
						<div class=" self-center font-medium text-base font-primary" style="padding:4px 10px;">{$i18n.t('Workspace')}</div>
					</div>
				</a>
			</div>

			<div class="px-1.5 flex justify-center text-gray-800 dark:text-gray-200">
				<div
					class="grow flex items-center space-x-3 rounded-lg px-2 py-[7px] hover:bg-gray-100 dark:hover:bg-gray-900 transition"
					on:click={() => {
						selectedChatId = null;
						chatId.set('');

						if ($mobile) {
							showSidebar.set(false);
						}
					}}
					draggable="false"
				>
					<div class="self-center">
						<svg
							width="24"
							height="24"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 18 18"
							stroke="currentColor"
							stroke-width="1"
							class="size-[1.1rem]"
						>
						<path d="M7.44138 9.89106H3.22263C2.91197 9.89106 2.66013 10.1429 2.66013 10.4536V14.6723C2.66013 14.983 2.91197 15.2348 3.22263 15.2348H7.44138C7.75203 15.2348 8.00388 14.983 8.00388 14.6723V10.4536C8.00388 10.1429 7.75203 9.89106 7.44138 9.89106ZM6.87888 14.1098H3.78513V11.0161H6.87888V14.1098ZM7.44138 3.08168H3.22263C2.91197 3.08168 2.66013 3.33352 2.66013 3.64418V7.86293C2.66013 8.17359 2.91197 8.42543 3.22263 8.42543H7.44138C7.75203 8.42543 8.00388 8.17359 8.00388 7.86293V3.64418C8.00388 3.3335 7.75203 3.08168 7.44138 3.08168ZM6.87888 7.30043H3.78513V4.20668H6.87888V7.30043ZM14.4258 9.89106H10.2071C9.89641 9.89106 9.64457 10.1429 9.64457 10.4536V14.6723C9.64457 14.983 9.89641 15.2348 10.2071 15.2348H14.4258C14.7365 15.2348 14.9883 14.983 14.9883 14.6723V10.4536C14.9883 10.1429 14.7365 9.89106 14.4258 9.89106ZM13.8633 14.1098H10.7696V11.0161H13.8633V14.1098ZM15.1751 5.39095L12.7142 2.93001C12.4945 2.71034 12.1384 2.71034 11.9187 2.93001L9.45775 5.39095C9.23809 5.61063 9.23809 5.96678 9.45775 6.18645L11.9187 8.64739C12.0285 8.75723 12.1725 8.81215 12.3164 8.81215C12.4604 8.81215 12.6044 8.75723 12.7142 8.64739L15.1751 6.18645C15.3948 5.96678 15.3948 5.61063 15.1751 5.39095ZM12.3164 7.45415L10.651 5.78871L12.3164 4.12327L13.9819 5.78871L12.3164 7.45415Z" fill="#515151"/>
						</svg>
					</div>

					<div class="flex self-center translate-y-[0.5px]">
						<div class=" self-center font-medium text-base font-primary" style="padding:4px 10px;">智能体广场</div>
					</div>
				</div>
			</div>

			<div class="px-1.5 flex justify-center text-gray-800 dark:text-gray-200">
				<div
					class="grow flex items-center space-x-3 rounded-lg px-2 py-[7px] hover:bg-gray-100 dark:hover:bg-gray-900 transition"
					on:click={() => {
						selectedChatId = null;
						chatId.set('');

						if ($mobile) {
							showSidebar.set(false);
						}
					}}
					draggable="false"
				>
					<div class="self-center">
						<svg
							width="24"
							height="24"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 18 18"
							stroke="currentColor"
							class="size-[1.1rem]"
						>
							<path d="M3.64754 16C3.51448 16 3.3902 15.9488 3.29662 15.8552C3.20451 15.7631 3.15187 15.6359 3.15187 15.5043V12.0537C3.15187 12.0259 3.1314 12.0025 3.10362 11.9981C2.53192 11.9236 1.51866 11.7101 1.14874 11.1106C0.967431 10.8167 0.951347 10.4643 1.10341 10.1207C1.50111 9.2259 2.16346 8.57963 2.52169 8.27551C2.53192 8.26674 2.53923 8.25358 2.54069 8.24042C2.67083 7.19791 3.5832 2 8.80889 2C11.6542 2 13.9542 3.28815 14.9616 5.44334C16.0348 7.74329 15.4046 10.5959 13.2319 13.2716C13.2231 13.2819 13.2202 13.2936 13.2202 13.3067V15.4195C13.2202 15.6929 12.9979 15.9152 12.7245 15.9152C12.4511 15.9152 12.2288 15.6929 12.2288 15.4195V13.1064C12.2288 12.9895 12.2698 12.8769 12.3444 12.7877C14.365 10.3737 14.9923 7.8471 14.0653 5.86005C13.2246 4.06162 11.2609 2.98841 8.81036 2.98841C3.89464 2.98841 3.52033 8.31937 3.50571 8.546C3.49547 8.69368 3.42237 8.82966 3.30247 8.91739C3.21036 8.98757 2.41495 9.60898 2.00994 10.5214C2.00409 10.536 2.00409 10.5521 2.00994 10.5652C2.11375 10.8109 2.9691 11.0199 3.67093 11.055C3.93558 11.0682 4.14174 11.2846 4.1432 11.5492V14.9516C4.1432 14.9823 4.16806 15.0072 4.19876 15.0072H6.9666C7.24002 15.0072 7.46226 15.2295 7.46226 15.5029C7.46226 15.7763 7.24002 15.9985 6.9666 15.9985H3.64754V16Z" fill="#515151"/>
							<path d="M9.31772 11.5784C9.10863 11.5784 8.92148 11.4468 8.8513 11.2509L8.53986 10.34C8.53255 10.3181 8.51062 10.302 8.48722 10.302H6.85109C6.82769 10.302 6.80576 10.3166 6.79845 10.3385L6.46801 11.2582C6.39344 11.4454 6.21213 11.5667 6.00889 11.5667C5.95187 11.5667 5.89485 11.5565 5.84075 11.5375C5.58926 11.4468 5.45474 11.1763 5.53662 10.9205L7.23709 6.18897C7.30728 5.99304 7.49443 5.86145 7.70352 5.86145C7.91699 5.86291 8.10414 5.99743 8.1714 6.19628L9.78999 10.9292C9.87333 11.1836 9.73297 11.4644 9.47855 11.5506C9.42592 11.5696 9.37328 11.5784 9.31772 11.5784ZM7.68889 7.96693C7.6655 7.96693 7.64357 7.98155 7.63626 8.00349L7.19469 9.23461C7.18884 9.25216 7.19177 9.27116 7.202 9.28578C7.21224 9.30041 7.22978 9.30918 7.24733 9.30918H8.10999C8.12754 9.30918 8.14508 9.30041 8.15532 9.28578C8.16555 9.27116 8.16848 9.25216 8.16263 9.23461L7.74153 8.00349C7.73422 7.98155 7.71375 7.96693 7.68889 7.96693ZM10.9787 11.5419C10.7053 11.5419 10.483 11.3269 10.483 11.0637V6.34396C10.483 6.08077 10.7053 5.86584 10.9787 5.86584C11.2521 5.86584 11.4744 6.08077 11.4744 6.34396V11.0652C11.4729 11.3284 11.2507 11.5419 10.9787 11.5419Z" fill="#515151"/>
						</svg>
					</div>

					<div class="flex self-center translate-y-[0.5px]">
						<div class=" self-center font-medium text-base font-primary" style="padding:4px 10px;">开发者中心</div>
					</div>
				</div>
			</div>

			<div class="px-1.5 flex justify-center text-gray-800 dark:text-gray-200">
				<div
					class="grow flex items-center space-x-3 rounded-lg px-2 py-[7px] hover:bg-gray-100 dark:hover:bg-gray-900 transition"
					on:click={() => {
						selectedChatId = null;
						chatId.set('');

						if ($mobile) {
							showSidebar.set(false);
						}
					}}
					draggable="false"
				>
					<div class="self-center">
						<svg
							width="24"
							height="24"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 18 18"
							stroke="currentColor"
							class="size-[1.1rem]"
						>
							<g clip-path="url(#clip0_18_94)">
							<path d="M6.01712 5.62166C6.25811 5.62166 6.47019 5.74256 6.60246 5.9286C6.69628 5.98257 6.77123 6.06563 6.81668 6.16599L6.83328 6.20905L9.91099 15.2363C10.0106 15.5273 9.8328 15.8524 9.5147 15.9629C9.21266 16.0677 8.89241 15.9419 8.77566 15.6791L8.75959 15.6366L7.96165 13.2975H3.9762L3.17933 15.6366C3.07972 15.9275 2.7418 16.0738 2.42423 15.9629C2.12165 15.858 1.94653 15.5593 2.01508 15.28L2.0274 15.2358L5.10457 6.2096C5.13514 6.12536 5.18531 6.05014 5.25068 5.99055C5.31604 5.93097 5.3946 5.88885 5.47945 5.86788C5.5472 5.79026 5.63004 5.72823 5.72258 5.68581C5.81513 5.64338 5.91531 5.62153 6.01659 5.62166H6.01712ZM11.6766 8.17991C11.9964 8.17991 12.2582 8.34442 12.2839 8.5531L12.2856 8.58622V15.5565C12.2856 15.7812 12.0124 15.9629 11.6766 15.9629C11.3569 15.9629 11.0951 15.7989 11.0699 15.5897L11.0672 15.5565V8.58678C11.0672 8.36209 11.3403 8.18046 11.6766 8.18046V8.17991ZM5.96839 7.45284L4.39499 12.0675H7.54232L5.96839 7.45229V7.45284ZM14.7886 4.33978C14.8164 4.34883 14.8418 4.36456 14.8625 4.38568C14.8833 4.40679 14.8989 4.43268 14.9081 4.46123L15.3842 5.95676L16.8729 6.50109C16.9097 6.51452 16.9415 6.53966 16.9635 6.57288C16.9856 6.6061 16.9968 6.64569 16.9956 6.68592C16.9944 6.72616 16.9809 6.76496 16.9569 6.79674C16.9329 6.82851 16.8998 6.85161 16.8622 6.86269L15.404 7.28502L14.9525 8.75791C14.9406 8.79605 14.9173 8.82933 14.886 8.853C14.8546 8.87666 14.8168 8.88951 14.778 8.88969C14.7391 8.88988 14.7012 8.87739 14.6696 8.85402C14.6381 8.83065 14.6145 8.79759 14.6023 8.75957L14.1256 7.26459L12.6808 6.79203C12.6439 6.77975 12.6118 6.75583 12.5889 6.72365C12.566 6.69148 12.5535 6.65268 12.5532 6.61278C12.5529 6.57287 12.5648 6.53388 12.5872 6.50135C12.6097 6.46881 12.6414 6.44438 12.6781 6.43153L14.1064 5.93578L14.5578 4.46344C14.5726 4.41553 14.6052 4.37562 14.6484 4.35244C14.6917 4.32926 14.7421 4.3247 14.7886 4.33978ZM11.5122 3.0071C11.5316 3.0138 11.5491 3.02516 11.5634 3.04023C11.5776 3.0553 11.5882 3.07366 11.5942 3.09378L11.8657 3.98866L12.7584 4.30058C12.7846 4.3094 12.8073 4.32665 12.8233 4.34979C12.8392 4.37293 12.8475 4.40074 12.847 4.42912C12.8465 4.4575 12.8371 4.48495 12.8203 4.50743C12.8035 4.5299 12.7801 4.54622 12.7536 4.55397L11.8646 4.82669L11.5744 5.72545C11.5658 5.75209 11.5493 5.77524 11.5272 5.79157C11.505 5.8079 11.4784 5.81657 11.4512 5.81633C11.424 5.81608 11.3976 5.80693 11.3757 5.79021C11.3539 5.77348 11.3377 5.75003 11.3296 5.72324L11.0581 4.82835L10.1932 4.55894C10.1671 4.55096 10.1441 4.53464 10.1276 4.51233C10.1111 4.49002 10.1018 4.46288 10.1013 4.43481C10.1007 4.40675 10.1087 4.37921 10.1243 4.35618C10.1399 4.33314 10.1621 4.3158 10.1879 4.30665L11.0597 3.99087L11.3494 3.09101C11.3548 3.07447 11.3632 3.05917 11.3743 3.046C11.3853 3.03282 11.3988 3.02203 11.4139 3.01423C11.4291 3.00644 11.4455 3.00179 11.4624 3.00057C11.4793 2.99935 11.4962 3.00157 11.5122 3.0071Z" fill="#515151"/>
							</g>
							<defs>
							<clipPath id="clip0_18_94">
							<rect width="15" height="13" fill="white" transform="translate(2 3)"/>
							</clipPath>
							</defs>
						</svg>
					</div>

					<div class="flex self-center translate-y-[0.5px]">
						<div class=" self-center font-medium text-base font-primary" style="padding:4px 10px;">智创工坊</div>
					</div>
				</div>
			</div>

			<div class="px-1.5 flex justify-center text-gray-800 dark:text-gray-200">
				<div
					class="grow flex items-center space-x-3 rounded-lg px-2 py-[7px] hover:bg-gray-100 dark:hover:bg-gray-900 transition"
					on:click={() => {
						selectedChatId = null;
						chatId.set('');

						if ($mobile) {
							showSidebar.set(false);
						}
					}}
					draggable="false"
				>
					<div class="self-center">
						<svg 
							width="24"
							height="24"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 18 18"
							stroke="currentColor"
							class="size-[1.1rem]"
						>
						<path d="M10.1269 13.8924C9.50497 14.0626 8.853 14.0875 8.22019 13.9652C7.58739 13.843 6.99028 13.5767 6.47395 13.1865C6.68209 12.8714 6.79349 12.5009 6.79411 12.1217C6.79474 11.7426 6.68456 11.3717 6.47746 11.0558C6.27035 10.74 5.97558 10.4932 5.63027 10.3467C5.28497 10.2001 4.90456 10.1603 4.53696 10.2323C4.16937 10.3043 3.83102 10.4848 3.56453 10.7511C3.29804 11.0175 3.11533 11.3577 3.03941 11.729C2.96349 12.1002 2.99775 12.486 3.13789 12.8376C3.27802 13.1892 3.51775 13.4909 3.82689 13.7048C4.10661 13.8952 4.43121 14.0071 4.76757 14.0291C5.10393 14.0511 5.44003 13.9823 5.7416 13.8299C6.38107 14.3547 7.13483 14.7176 7.94043 14.8885C8.74602 15.0594 9.58024 15.0335 10.3739 14.8128C10.4942 14.7756 10.595 14.6918 10.6545 14.5797C10.714 14.4675 10.7273 14.3361 10.6916 14.2141C10.653 14.0971 10.5732 13.9986 10.4673 13.9376C10.3615 13.8766 10.2371 13.8573 10.1181 13.8835L10.1269 13.8924Z" fill="#515151"/>
						<path d="M9.0063 3.00001C8.52772 3.00124 8.06745 3.18646 7.71857 3.51821C7.36968 3.84996 7.1582 4.30349 7.12689 4.78711C6.35839 5.08681 5.67123 5.56717 5.12202 6.18859C4.57282 6.81001 4.1773 7.55471 3.96807 8.3613C3.93802 8.48442 3.95613 8.61454 4.01862 8.72445C4.0811 8.83436 4.18313 8.91555 4.30336 8.95104C4.42494 8.98148 4.55343 8.96314 4.66196 8.89985C4.77049 8.83657 4.85067 8.73325 4.88572 8.6115C5.04838 7.9792 5.35155 7.3929 5.77208 6.89735C6.1926 6.4018 6.71938 6.01009 7.31218 5.75214C7.45902 6.06208 7.68529 6.32644 7.96738 6.51765C8.24948 6.70885 8.57707 6.81991 8.91599 6.83922C9.25491 6.85854 9.59274 6.7854 9.89423 6.62745C10.1957 6.4695 10.4499 6.23252 10.6301 5.94122C10.8104 5.64993 10.9101 5.31499 10.919 4.97135C10.9279 4.6277 10.8455 4.28794 10.6806 3.98751C10.5156 3.68707 10.274 3.43696 9.9811 3.26327C9.68817 3.08958 9.35458 2.99866 9.01513 3.00001H9.0063Z" fill="#515151"/>
						<path d="M14.1592 10.5237C14.2895 9.70233 14.2263 8.86145 13.9749 8.06953C13.7234 7.27761 13.2908 6.55705 12.7122 5.96656C12.67 5.9145 12.6175 5.87196 12.5581 5.84168C12.4987 5.8114 12.4337 5.79405 12.3673 5.79074C12.3008 5.78744 12.2344 5.79825 12.1724 5.82249C12.1103 5.84673 12.054 5.88386 12.007 5.93149C11.9599 5.97911 11.9233 6.03618 11.8993 6.09902C11.8754 6.16186 11.8647 6.22908 11.868 6.29635C11.8712 6.36362 11.8884 6.42945 11.9183 6.48961C11.9482 6.54977 11.9902 6.60293 12.0416 6.64566C12.5017 7.10751 12.8521 7.66932 13.0661 8.28856C13.2801 8.9078 13.3522 9.56823 13.2769 10.2199C12.8122 10.1735 12.3469 10.3007 11.9684 10.5775C11.5898 10.8543 11.3242 11.2616 11.2215 11.7229C11.1188 12.1841 11.186 12.6675 11.4105 13.082C11.6351 13.4966 12.0014 13.8137 12.4407 13.9739C12.88 14.1341 13.362 14.1261 13.7959 13.9516C14.2298 13.7771 14.5859 13.4481 14.797 13.0264C15.0081 12.6047 15.0599 12.1194 14.9424 11.6618C14.825 11.2041 14.5464 10.8057 14.1592 10.5415V10.5237Z" fill="#515151"/>
						</svg>
	
					</div>

					<div class="flex self-center translate-y-[0.5px]">
						<div class=" self-center font-medium text-base font-primary" style="padding:4px 10px;">教学实训</div>
					</div>
				</div>
			</div>
		{/if}

		<div class="relative {$temporaryChatEnabled ? 'opacity-20' : ''}">
			{#if $temporaryChatEnabled}
				<div class="absolute z-40 w-full h-full flex justify-center"></div>
			{/if}

			<SearchInput
				bind:value={search}
				on:input={searchDebounceHandler}
				placeholder={$i18n.t('Search')}
			/>
		</div>

		<div
			class="relative flex flex-col flex-1 overflow-y-auto overflow-x-hidden {$temporaryChatEnabled
				? 'opacity-20'
				: ''}"
		>
			{#if $config?.features?.enable_channels && ($user.role === 'admin' || $channels.length > 0) && !search}
				<Folder
					className="px-2 mt-0.5"
					name={$i18n.t('Channels')}
					dragAndDrop={false}
					onAdd={async () => {
						if ($user.role === 'admin') {
							await tick();

							setTimeout(() => {
								showCreateChannel = true;
							}, 0);
						}
					}}
					onAddLabel={$i18n.t('Create Channel')}
				>
					{#each $channels as channel}
						<ChannelItem
							{channel}
							onUpdate={async () => {
								await initChannels();
							}}
						/>
					{/each}
				</Folder>
			{/if}

			<Folder
				collapsible={!search}
				className="px-2 mt-0.5"
				name={$i18n.t('Chats')}
				onAdd={() => {
					createFolder();
				}}
				onAddLabel={$i18n.t('New Folder')}
				on:import={(e) => {
					importChatHandler(e.detail);
				}}
				on:drop={async (e) => {
					const { type, id, item } = e.detail;

					if (type === 'chat') {
						let chat = await getChatById(localStorage.token, id).catch((error) => {
							return null;
						});
						if (!chat && item) {
							chat = await importChat(localStorage.token, item.chat, item?.meta ?? {});
						}

						if (chat) {
							console.log(chat);
							if (chat.folder_id) {
								const res = await updateChatFolderIdById(localStorage.token, chat.id, null).catch(
									(error) => {
										toast.error(`${error}`);
										return null;
									}
								);
							}

							if (chat.pinned) {
								const res = await toggleChatPinnedStatusById(localStorage.token, chat.id);
							}

							initChatList();
						}
					} else if (type === 'folder') {
						if (folders[id].parent_id === null) {
							return;
						}

						const res = await updateFolderParentIdById(localStorage.token, id, null).catch(
							(error) => {
								toast.error(`${error}`);
								return null;
							}
						);

						if (res) {
							await initFolders();
						}
					}
				}}
			>
				{#if $temporaryChatEnabled}
					<div class="absolute z-40 w-full h-full flex justify-center"></div>
				{/if}

				{#if !search && $pinnedChats.length > 0}
					<div class="flex flex-col space-y-1 rounded-xl">
						<Folder
							className=""
							bind:open={showPinnedChat}
							on:change={(e) => {
								localStorage.setItem('showPinnedChat', e.detail);
								console.log(e.detail);
							}}
							on:import={(e) => {
								importChatHandler(e.detail, true);
							}}
							on:drop={async (e) => {
								const { type, id, item } = e.detail;

								if (type === 'chat') {
									let chat = await getChatById(localStorage.token, id).catch((error) => {
										return null;
									});
									if (!chat && item) {
										chat = await importChat(localStorage.token, item.chat, item?.meta ?? {});
									}

									if (chat) {
										console.log(chat);
										if (chat.folder_id) {
											const res = await updateChatFolderIdById(
												localStorage.token,
												chat.id,
												null
											).catch((error) => {
												toast.error(`${error}`);
												return null;
											});
										}

										if (!chat.pinned) {
											const res = await toggleChatPinnedStatusById(localStorage.token, chat.id);
										}

										initChatList();
									}
								}
							}}
							name={$i18n.t('Pinned')}
						>
							<div
								class="ml-3 pl-1 mt-[1px] flex flex-col overflow-y-auto scrollbar-hidden border-s border-gray-100 dark:border-gray-900"
							>
								{#each $pinnedChats as chat, idx}
									<ChatItem
										className=""
										id={chat.id}
										title={chat.title}
										{shiftKey}
										selected={selectedChatId === chat.id}
										on:select={() => {
											selectedChatId = chat.id;
										}}
										on:unselect={() => {
											selectedChatId = null;
										}}
										on:change={async () => {
											initChatList();
										}}
										on:tag={(e) => {
											const { type, name } = e.detail;
											tagEventHandler(type, name, chat.id);
										}}
									/>
								{/each}
							</div>
						</Folder>
					</div>
				{/if}

				{#if !search && folders}
					<Folders
						{folders}
						on:import={(e) => {
							const { folderId, items } = e.detail;
							importChatHandler(items, false, folderId);
						}}
						on:update={async (e) => {
							initChatList();
						}}
						on:change={async () => {
							initChatList();
						}}
					/>
				{/if}

				<div class=" flex-1 flex flex-col overflow-y-auto scrollbar-hidden">
					<div class="pt-1.5">
						{#if $chats}
							{#each $chats as chat, idx}
								{#if idx === 0 || (idx > 0 && chat.time_range !== $chats[idx - 1].time_range)}
									<div
										class="w-full pl-2.5 text-xs text-gray-500 dark:text-gray-500 font-medium {idx ===
										0
											? ''
											: 'pt-5'} pb-1.5"
									>
										{$i18n.t(chat.time_range)}
										<!-- localisation keys for time_range to be recognized from the i18next parser (so they don't get automatically removed):
							{$i18n.t('Today')}
							{$i18n.t('Yesterday')}
							{$i18n.t('Previous 7 days')}
							{$i18n.t('Previous 30 days')}
							{$i18n.t('January')}
							{$i18n.t('February')}
							{$i18n.t('March')}
							{$i18n.t('April')}
							{$i18n.t('May')}
							{$i18n.t('June')}
							{$i18n.t('July')}
							{$i18n.t('August')}
							{$i18n.t('September')}
							{$i18n.t('October')}
							{$i18n.t('November')}
							{$i18n.t('December')}
							-->
									</div>
								{/if}

								<ChatItem
									className=""
									id={chat.id}
									title={chat.title}
									{shiftKey}
									selected={selectedChatId === chat.id}
									on:select={() => {
										selectedChatId = chat.id;
									}}
									on:unselect={() => {
										selectedChatId = null;
									}}
									on:change={async () => {
										initChatList();
									}}
									on:tag={(e) => {
										const { type, name } = e.detail;
										tagEventHandler(type, name, chat.id);
									}}
								/>
							{/each}

							{#if $scrollPaginationEnabled && !allChatsLoaded}
								<Loader
									on:visible={(e) => {
										if (!chatListLoading) {
											loadMoreChats();
										}
									}}
								>
									<div
										class="w-full flex justify-center py-1 text-xs animate-pulse items-center gap-2"
									>
										<Spinner className=" size-4" />
										<div class=" ">Loading...</div>
									</div>
								</Loader>
							{/if}
						{:else}
							<div class="w-full flex justify-center py-1 text-xs animate-pulse items-center gap-2">
								<Spinner className=" size-4" />
								<div class=" ">Loading...</div>
							</div>
						{/if}
					</div>
				</div>
			</Folder>
		</div>

		<div class="px-2">
			<div class="flex flex-col font-primary">
				{#if $user !== undefined}
					<UserMenu
						role={$user.role}
						on:show={(e) => {
							if (e.detail === 'archived-chat') {
								showArchivedChats.set(true);
							}
						}}
					>
						<button
							class=" flex items-center rounded-xl py-2.5 px-2.5 w-full hover:bg-gray-100 dark:hover:bg-gray-900 transition"
							on:click={() => {
								showDropdown = !showDropdown;
							}}
						>
							<div class=" self-center mr-3">
								<img
									src={$user.profile_image_url}
									class=" max-w-[30px] object-cover rounded-full"
									alt="User profile"
								/>
							</div>
							<div class=" self-center font-medium">{$user.name}</div>
						</button>
					</UserMenu>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.scrollbar-hidden:active::-webkit-scrollbar-thumb,
	.scrollbar-hidden:focus::-webkit-scrollbar-thumb,
	.scrollbar-hidden:hover::-webkit-scrollbar-thumb {
		visibility: visible;
	}
	.scrollbar-hidden::-webkit-scrollbar-thumb {
		visibility: hidden;
	}
</style>
