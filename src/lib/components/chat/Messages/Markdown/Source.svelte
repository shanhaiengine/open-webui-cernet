<script lang="ts">
	export let token;
	export let onClick: Function = () => {};

	let attributes: Record<string, string> = {};

	function extractAttributes(input: string): Record<string, string> {
		const regex = /(\w+)="([^"]*)"/g;
		let match;
		let attrs: Record<string, string> = {};

		// Loop through all matches and populate the attributes object
		while ((match = regex.exec(input)) !== null) {
			attrs[match[1]] = match[2];
		}

		// [fix] 避免title为undefined时的后续md报错
		if(attrs.title === undefined) attrs.title = ""
		return attrs;
	}

	// Helper function to return only the domain from a URL
	function getDomain(url: string): string {
		const domain = url.replace('http://', '').replace('https://', '').split(/[/?#]/)[0];
		return domain;
	}

	// Helper function to check if text is a URL and return the domain
	function formattedTitle(title: string | undefined): string {
		if(title === undefined) return ''

		if (title.startsWith('http')) {
			return getDomain(title);
		}
		return title;
	}

	$: attributes = extractAttributes(token.text);
</script>

<button
	class="text-xs font-medium w-fit translate-y-[2px] px-2 py-0.5 dark:bg-white/5 dark:text-white/60 dark:hover:text-white bg-gray-50 text-black/60 hover:text-black transition rounded-lg"
	on:click={() => {
		onClick(attributes.data);
	}}
>
	<span class="line-clamp-1">
		{formattedTitle(attributes.title)}
	</span>
</button>
