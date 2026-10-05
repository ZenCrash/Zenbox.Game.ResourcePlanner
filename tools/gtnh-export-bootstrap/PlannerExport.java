package plannerexport;

import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.Mod.EventHandler;
import cpw.mods.fml.common.event.FMLInitializationEvent;
import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

/** Development-only exporter. It refuses to run outside the explicitly marked extraction copy. */
@Mod(modid="plannerexport", name="Resource Planner Export Bootstrap", version="1.0", dependencies="after:gtnhdumper")
public class PlannerExport {
    private int ticks, phase;
    private boolean disabled;
    private boolean fluidsOnly;
    private boolean repairsOnly;
    private boolean blocksOnly;
    private boolean castingOnly;
    private boolean thaumOnly;
    private File output;
    private final Map<String,Object> stacks = new LinkedHashMap<String,Object>();
    private final List<String> errors = new ArrayList<String>();
    private final Set<String> visible = new LinkedHashSet<String>();

    @EventHandler public void init(FMLInitializationEvent event) { FMLCommonHandler.instance().bus().register(this); }
    @SubscribeEvent public void tick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END || disabled || ++ticks < 200) return;
        try {
            Object mc = call(Class.forName("net.minecraft.client.Minecraft"), "func_71410_x|getMinecraft");
            File game = (File)field(mc,"field_71412_D|mcDataDir");
            String canonical = game.getCanonicalPath().replace('\\','/');
            if (!canonical.endsWith("/data/extraction/instance/minecraft") || !new File(game,"planner-export.enabled").isFile()) { disabled=true; return; }
            thaumOnly = new File(game,"planner-export.thaum-only").isFile();
            output = new File(game,thaumOnly?"dumps/planner-thaum":"dumps/planner"); output.mkdirs();
            Object world = field(mc,"field_71441_e|theWorld");
            Object player = field(mc,"field_71439_g|thePlayer");
            if (phase == 0) {
                status("creating isolated export world");
                phase=1; ticks=0;
                if (world == null) {
                    Class<?> settings = Class.forName("net.minecraft.world.WorldSettings");
                    Class<?> gameType = Class.forName("net.minecraft.world.WorldSettings$GameType");
                    Class<?> worldType = Class.forName("net.minecraft.world.WorldType");
                    Object creative = null;
                    for (Object e : gameType.getEnumConstants()) if (e.toString().equals("CREATIVE")) creative=e;
                    Object flat = field(worldType,"field_77138_c|FLAT");
                    Object setup = settings.getConstructor(long.class,gameType,boolean.class,boolean.class,worldType).newInstance(12345L,creative,false,false,flat);
                    call(setup,"func_77159_a|enableCommands");
                    call(mc,"func_71371_a|launchIntegratedServer","PlannerExport","Planner export",setup);
                }
                return;
            }
            if (world == null || player == null) return;
            if (phase == 1) {
                if(new File(game,"planner-export.ores-only").isFile()) {
                    Class<?> ore = Class.forName("net.minecraftforge.oredict.OreDictionary");
                    Map<String,Object> groups = new TreeMap<String,Object>();
                    for(String name:(String[])call(ore,"getOreNames")) {
                        List<Object> members = new ArrayList<Object>();
                        for(Object stack:(Iterable<?>)call(ore,"getOres",name)) {
                            Object item=call(stack,"func_77973_b|getItem");
                            Object registry=field(Class.forName("net.minecraft.item.Item"),"field_150901_e|itemRegistry");
                            members.add(Arrays.asList(String.valueOf(call(registry,"func_148750_c|getNameForObject",item)),call(stack,"func_77960_j|getItemDamage")));
                        }
                        groups.put(name,members);
                    }
                    write("ore-dictionary.json",groups);status("ore dictionary complete");
                    disabled=true;call(mc,"func_71400_g|shutdown");return;
                }
                if(new File(game,"planner-export.material-icons.json").isFile()){exportMaterialIcons(game);disabled=true;call(mc,"func_71400_g|shutdown");return;}
                if(new File(game,"planner-export.more-layouts").isFile()){exportMoreLayouts();disabled=true;call(mc,"func_71400_g|shutdown");return;}
                if(new File(game,"planner-export.layouts-only").isFile()) {
                    exportLayouts(game,mc);disabled=true;call(mc,"func_71400_g|shutdown");return;
                }
                if(new File(game,"planner-export.alchemy-only").isFile()) {
                    status("capturing Alchemic Chemistry Set LP and orb requirements");
                    Object handler=Class.forName("WayofTime.alchemicalWizardry.client.nei.NEIAlchemyRecipeHandler").newInstance();
                    call(handler,"loadCraftingRecipes",call(handler,"getOverlayIdentifier"),new Object[0]);
                    List<Object> rows=new ArrayList<Object>();
                    List<?> cached=(List<?>)field(handler,"arecipes");
                    for(int i=0;i<cached.size();i++) {
                        Map<String,Object> row=new LinkedHashMap<String,Object>();
                        row.put("inputs",positioned(call(handler,"getIngredientStacks",i)));
                        row.put("outputs",positioned(call(handler,"getResultStack",i)));
                        row.put("orbs",positioned(call(handler,"getOtherStacks",i)));
                        row.put("lp",field(cached.get(i),"lp"));rows.add(row);
                    }
                    write("alchemy-recipes.json",rows);status("finished alchemy export");
                    disabled=true;call(mc,"func_71400_g|shutdown");return;
                }
                if (thaumOnly) {
                    status("capturing locked Thaumcraft baseline");
                    dumpRecipes();
                    Files.copy(new File(output,"recipes.json").toPath(), new File(output,"recipes-before-research.json").toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    Object research;
                    try(InputStream stream=new FileInputStream(new File(game,"planner-export.research.thaum"))) {
                        research=call(Class.forName("net.minecraft.nbt.CompressedStreamTools"),"func_74796_a|readCompressed",stream);
                    }
                    Class<?> manager=Class.forName("thaumcraft.common.lib.research.ResearchManager");
                    call(manager,"loadResearchNBT",research,player);
                    call(manager,"loadAspectNBT",research,player);
                    List<Object> aspects=new ArrayList<Object>();
                    for(Object aspect:((Map<?,?>)field(Class.forName("thaumcraft.api.aspects.Aspect"),"aspects")).values()) {
                        Map<String,Object> row=new LinkedHashMap<String,Object>();
                        row.put("key",call(aspect,"getTag"));
                        List<Object> components=new ArrayList<Object>();Object parts=call(aspect,"getComponents");
                        if(parts!=null)for(int i=0;i<Array.getLength(parts);i++)components.add(call(Array.get(parts,i),"getTag"));
                        row.put("components",components);aspects.add(row);
                    }
                    write("aspects.json",aspects);
                    status("capturing Thaumcraft with Pieman research");
                    dumpRecipes();
                    phase=3;ticks=0;return;
                }
                if(new File(game,"planner-export.infernal-only").isFile()) {
                    status("capturing Infernal Blast Furnace bonus slots");
                    Object handler=Class.forName("witchinggadgets.client.nei.NEIInfernalBlastfurnaceHandler").newInstance();
                    call(handler,"loadCraftingRecipes",call(handler,"getOverlayIdentifier"),new Object[0]);
                    List<Object> rows=new ArrayList<Object>();
                    int count=((Number)call(handler,"numRecipes")).intValue();
                    for(int i=0;i<count;i++) {
                        Map<String,Object> row=new LinkedHashMap<String,Object>();
                        row.put("inputs",positioned(call(handler,"getIngredientStacks",i)));
                        row.put("outputs",positioned(call(handler,"getResultStack",i)));
                        row.put("bonus",positioned(call(handler,"getOtherStacks",i)));rows.add(row);
                    }
                    write("infernal-recipes.json",rows);status("Infernal Blast Furnace capture complete");
                    disabled=true;call(mc,"func_71400_g|shutdown");return;
                }
                if(new File(game,"planner-export.casting-only").isFile()) {
                    castingOnly=true;
                    status("capturing Tinkers Construct casting table registry");
                    List<Object> rows=new ArrayList<Object>();
                    Object casting=call(Class.forName("tconstruct.library.TConstructRegistry"),"getTableCasting");
                    for(Object recipe:(Iterable<?>)call(casting,"getCastingRecipes")) {
                        Map<String,Object> row=new LinkedHashMap<String,Object>();
                        row.put("output",castingItem(field(recipe,"output")));
                        row.put("cast",castingItem(field(recipe,"cast")));
                        row.put("consumeCast",field(recipe,"consumeCast"));
                        row.put("ignoreNBT",field(recipe,"ignoreNBT"));
                        row.put("durationTicks",field(recipe,"coolTime"));
                        Object fluid=field(recipe,"castingMetal");
                        row.put("fluid", "fluid:"+call(call(fluid,"getFluid"),"getName"));
                        row.put("amount",field(fluid,"amount"));rows.add(row);
                    }
                    write("casting-table.json",rows);
                    status("casting table registry captured: "+rows.size()+" recipes; rendering referenced items");
                    phase=4;ticks=0;return;
                }
                blocksOnly=new File(game,"planner-export.block-images.json").isFile();
                File repairFile=new File(game,blocksOnly?"planner-export.block-images.json":"planner-export.image-repairs.json");
                if(repairFile.isFile()) {
                    repairsOnly=!blocksOnly;status(blocksOnly?"loading block image variants":"loading specific missing image variants");
                    Object gson=Class.forName("com.google.gson.Gson").newInstance();
                    List<?> requests=(List<?>)call(gson,"fromJson",new String(Files.readAllBytes(repairFile.toPath()),StandardCharsets.UTF_8),List.class);
                    for(Object request:requests) {
                        Map<?,?> row=(Map<?,?>)request;String id=String.valueOf(row.get("id"));
                        try {
                            Object registry=field(Class.forName("net.minecraft.item.Item"),"field_150901_e|itemRegistry");
                            Object item=call(registry,"func_82594_a|getObject",row.get("registryId"));
                            if(blocksOnly && !Class.forName("net.minecraft.item.ItemBlock").isInstance(item))continue;
                            int metadata=((Number)row.get("metadata")).intValue();
                            // Wildcards have no unique appearance; render the specified representative.
                            if(metadata==32767)metadata=((Number)row.get("representativeMetadata")).intValue();
                            Object stack=Class.forName("net.minecraft.item.ItemStack").getConstructor(Class.forName("net.minecraft.item.Item"),int.class,int.class).newInstance(item,1,metadata);
                            String nbt=String.valueOf(row.get("nbt"));
                            if(!nbt.isEmpty())call(stack,"func_77982_d|setTagCompound",call(Class.forName("net.minecraft.nbt.JsonToNBT"),"func_150315_a|getTagFromJson",nbt));
                            stacks.put(id,stack);
                        }catch(Throwable error){errors.add("Repair "+id+": "+error);}
                    }
                    phase=4;ticks=0;return;
                }
                if(new File(game,"planner-export.fluids-only").isFile()) {
                    fluidsOnly=true;status("capturing registered fluid display stacks");
                    List<Object> fluidRows=new ArrayList<Object>();
                    Map<?,?> registry=(Map<?,?>)call(Class.forName("net.minecraftforge.fluids.FluidRegistry"),"getRegisteredFluids");
                    for(Object fluid:registry.values()) {
                        String id="fluid:"+call(fluid,"getName");
                        try {
                            Object stack=call(Class.forName("gregtech.api.util.GTUtility"),"getFluidDisplayStack",fluid);
                            if(stack==null)continue;stacks.put(id,stack);
                            Map<String,Object> row=new LinkedHashMap<String,Object>();row.put("id",id);
                            row.put("name",call(stack,"func_82833_r|getDisplayName"));
                            row.put("tooltip",call(Class.forName("com.iouter.gtnhdumper.common.utils.Utils"),"getTooltip",stack));
                            row.put("temperature",call(fluid,"getTemperature"));row.put("density",call(fluid,"getDensity"));
                            row.put("gaseous",call(fluid,"isGaseous"));fluidRows.add(row);
                        }catch(Throwable error){errors.add(id+": "+error);}
                    }
                    write("fluids.json",fluidRows);phase=4;ticks=0;return;
                }
                status("loading NEI item panel"); phase=2; ticks=0;
                Object screen = construct("net.minecraft.client.gui.inventory.GuiInventory",player);
                call(mc,"func_147108_a|displayGuiScreen",screen);
                call(Class.forName("codechicken.nei.ItemList"),"loadItems"); return;
            }
            if (phase == 2) {
                if (!Boolean.TRUE.equals(field(Class.forName("codechicken.nei.ItemList"),"loadFinished"))) return;
                Object panel=field(Class.forName("codechicken.nei.ItemPanels"),"itemPanel");
                Collection<?> panelItems=(Collection<?>)call(panel,"getItems");
                if(panelItems.isEmpty()) return;
                if(new File(game,"planner-export.tooltips-only").isFile()){exportTooltipVariants();disabled=true;call(mc,"func_71400_g|shutdown");return;}
                status("capturing NEI visibility and recipe handlers"); phase=3;
                // ItemList already excludes ItemInfo.isHidden stacks. The panel list
                // additionally applies collapsed groups and the current search, so it
                // cannot define which items belong in a searchable offline catalog.
                for(Object stack : (Iterable<?>)field(Class.forName("codechicken.nei.ItemList"),"items")) visible.add(addStack(stack));
                write("visible-items.json",visible);
                Map<Integer,Map<String,Object>> groups=new LinkedHashMap<Integer,Map<String,Object>>();
                Class<?> grouping=Class.forName("codechicken.nei.CollapsibleItems");
                for(Map.Entry<String,Object> entry:stacks.entrySet()) {
                    int index=((Number)call(grouping,"getGroupIndex",entry.getValue())).intValue();
                    if(index<0)continue;
                    Map<String,Object> group=groups.get(index);
                    if(group==null){group=new LinkedHashMap<String,Object>();group.put("id",String.valueOf(index));group.put("name",call(grouping,"getDisplayName",index));group.put("items",new ArrayList<String>());groups.put(index,group);}
                    ((List<String>)group.get("items")).add(entry.getKey());
                }
                Map<String,Object> groupExport=new LinkedHashMap<String,Object>();groupExport.put("groups",groups.values());
                for(String state:Arrays.asList("collapsed","expanded"))groupExport.put(state+"Color",call(call(Class.forName("codechicken.nei.NEIClientConfig"),"getSetting","inventory.collapsibleItems."+state+"Color"),"getHexValue"));
                write("item-groups.json",groupExport);
                if(new File(game,"planner-export.visibility-only").isFile()) {
                    status("visibility export complete: "+visible.size()+" searchable items");
                    disabled=true;call(mc,"func_71400_g|shutdown");return;
                }
                dumpRecipes(); ticks=0; return;
            }
            if (phase == 3) {
                status("exporting item names, NBT and tooltips"); phase=4;
                List<Map<String,Object>> items = new ArrayList<Map<String,Object>>();
                Class<?> utils=Class.forName("com.iouter.gtnhdumper.common.utils.Utils");
                for(Map.Entry<String,Object> entry: stacks.entrySet()) {
                    try {
                        Object stack=entry.getValue(); Map<String,Object> row=new LinkedHashMap<String,Object>();
                        row.put("id",entry.getKey()); row.put("key",call(utils,"getItemKey",stack)); row.put("nbt",call(utils,"getItemNBT",stack));
                        row.put("name",call(stack,"func_82833_r|getDisplayName"));
                        row.put("tooltip",call(utils,"getTooltip",stack)); row.put("hidden",!visible.contains(entry.getKey()));
                        row.put("icon",call(Class.forName("com.iouter.gtnhdumper.common.dumper.ItemIconDumper"),"getIconFileName",stack));
                        items.add(row);
                    } catch(Throwable error) { errors.add("Item "+entry.getKey()+": "+error); }
                }
                write("items.json",items);
                // Limit the icon renderer to precisely the visible panel and recipe-referenced stacks.
                Field all=Class.forName("com.iouter.gtnhdumper.common.utils.AllItemStacks").getDeclaredField("allItemStacks");all.setAccessible(true);all.set(null,new ArrayList<Object>(stacks.values()));
                ticks=0;return;
            }
            if (phase == 4) {
                status(blocksOnly?"rendering 256px block icons":"rendering original item icons");phase=5;
                int iconSize=blocksOnly?256:32;
                Class<?> dumper=Class.forName("com.iouter.gtnhdumper.common.dumper.ItemIconDumper");
                Object fbo=Class.forName("com.iouter.gtnhdumper.common.utils.FBOHelper").getConstructor(int.class).newInstance(iconSize);
                Object renderer=call(Class.forName("net.minecraft.client.renderer.entity.RenderItem"),"getInstance");
                File icons=new File(game,thaumOnly?"dumps/thaum-icons":blocksOnly?"dumps/block-icons":"dumps/icons");icons.mkdirs();int done=0;
                List<Object> rendered=new ArrayList<Object>();
                for(Map.Entry<String,Object> entry:stacks.entrySet()) {
                    try {
                        String filename=(String)call(dumper,"getIconFileName",entry.getValue());
                        Object renderStack=entry.getValue();
                        if(entry.getKey().startsWith("thaumcraftneiplugin:Aspect:")) {
                            renderStack=call(renderStack,"func_77946_l|copy");
                            call(renderStack,"func_77964_b|setItemDamage",0);
                        }
                        java.awt.image.BufferedImage img=(java.awt.image.BufferedImage)call(dumper,"renderItem",renderStack,fbo,renderer,1f,null);
                        javax.imageio.ImageIO.write(img,"png",new File(icons,filename));
                        call(fbo,"restoreTexture");rendered.add(Arrays.asList(entry.getKey(),filename,iconSize,1));
                    } catch(Throwable error){errors.add("Icon "+entry.getKey()+": "+error);}
                    if(++done%1000==0) { status("rendered "+done+" / "+stacks.size()+" item icons");write(blocksOnly?"block-errors.json":repairsOnly?"repair-errors.json":fluidsOnly?"fluid-errors.json":"errors.json",errors); }
                }
                write(castingOnly?"casting-icons.json":blocksOnly?"block-icons.json":repairsOnly?"repair-icons.json":fluidsOnly?"fluid-icons.json":"icons.json",rendered);ticks=0;return;
            }
            if (phase == 5) {
                write(blocksOnly?"block-errors.json":repairsOnly?"repair-errors.json":fluidsOnly?"fluid-errors.json":"errors.json",errors);status("finished; validation required");disabled=true;
                call(mc,"func_71400_g|shutdown");
            }
        } catch(Throwable error) {
            errors.add(error.toString());error.printStackTrace(); disabled=true;
            try { write(blocksOnly?"block-errors.json":repairsOnly?"repair-errors.json":fluidsOnly?"fluid-errors.json":"errors.json",errors);status("failed: "+error); } catch(Throwable ignored) {}
        }
    }




    private void exportMaterialIcons(File game) throws Exception {
        status("capturing material icon sources for project-only image repairs");
        Object gson=Class.forName("com.google.gson.Gson").newInstance();
        List<?> requests=(List<?>)call(gson,"fromJson",new String(Files.readAllBytes(new File(game,"planner-export.material-icons.json").toPath()),StandardCharsets.UTF_8),List.class);
        List<Object> rows=new ArrayList<Object>();
        Object registry=field(Class.forName("net.minecraft.item.Item"),"field_150901_e|itemRegistry");
        for(Object request:requests) {
            Map<?,?> input=(Map<?,?>)request;Map<String,Object> row=new LinkedHashMap<String,Object>();row.put("id",input.get("id"));
            try {
                Object item=call(registry,"func_82594_a|getObject",input.get("registryId"));
                int meta=((Number)input.get("metadata")).intValue();
                Object stack=Class.forName("net.minecraft.item.ItemStack").getConstructor(Class.forName("net.minecraft.item.Item"),int.class,int.class).newInstance(item,1,meta);
                row.put("rgba",call(item,"getRGBa",stack));
                Object icon=call(item,"getIcon",meta,0),overlay=call(item,"getOverlayIcon",meta,0);
                if(icon!=null)row.put("base",call(icon,"func_94215_i|getIconName"));
                if(overlay!=null)row.put("overlay",call(overlay,"func_94215_i|getIconName"));
            }catch(Throwable error){row.put("error",error.toString());}
            rows.add(row);
        }
        write("material-icons.json",rows);status("material icon source capture complete: "+rows.size());
    }

    private void exportTooltipVariants() throws Exception {
        status("capturing modifier-key item tooltips");
        java.nio.ByteBuffer keys=(java.nio.ByteBuffer)field(Class.forName("org.lwjgl.input.Keyboard"),"keyDownBuffer");
        int[] codes={42,54,29,157,56,184};byte[] saved=new byte[codes.length];for(int i=0;i<codes.length;i++){saved[i]=keys.get(codes[i]);keys.put(codes[i],(byte)0);}
        Map<String,Object> variants=new LinkedHashMap<String,Object>();int checked=0;
        try {for(Object stack:(Iterable<?>)field(Class.forName("codechicken.nei.ItemList"),"items"))try {
            for(int code:codes)keys.put(code,(byte)0);
            String normal=String.valueOf(call(Class.forName("com.iouter.gtnhdumper.common.utils.Utils"),"getTooltip",stack));checked++;
            if(!normal.replaceAll("§.","").toLowerCase(Locale.ROOT).matches("(?s).*(shift|ctrl|control|hold.*alt|press.*alt).*"))continue;
            Map<String,Object> states=new LinkedHashMap<String,Object>();states.put("0",normal);
            for(int mask=1;mask<8;mask++){keys.put(42,(byte)((mask&1)!=0?1:0));keys.put(29,(byte)((mask&2)!=0?1:0));keys.put(56,(byte)((mask&4)!=0?1:0));String text=String.valueOf(call(Class.forName("com.iouter.gtnhdumper.common.utils.Utils"),"getTooltip",stack));if(!text.equals(normal))states.put(String.valueOf(mask),text);}
            if(states.size()>1)variants.put(addStack(stack),states);
        }catch(Throwable e){errors.add("Tooltip: "+e);}}
        finally {for(int i=0;i<codes.length;i++)keys.put(codes[i],saved[i]);}
        write("tooltip-variants.json",variants);write("tooltip-errors.json",errors);status("modifier tooltips complete: "+variants.size()+" / "+checked);
    }

    private void exportMoreLayouts() throws Exception {
        status("capturing additional recipe layouts");List<Object> rows=new ArrayList<Object>();
        for(Object handler:(Iterable<?>)field(Class.forName("codechicken.nei.recipe.GuiUsageRecipe"),"usagehandlers"))try {
            String name=String.valueOf(call(handler,"getRecipeName"));
            if(!Arrays.asList("Scanner","Research Station","Tree Growth Simulator","Squeezer").contains(name))continue;
            if(name.equals("Squeezer")) {
                call(handler,"loadCraftingRecipes",call(handler,"getOverlayIdentifier"),new Object[0]);List<?> cached=(List<?>)field(handler,"arecipes");
                for(int i=0;i<cached.size();i++){Object c=cached.get(i);Map<String,Object> r=new LinkedHashMap<String,Object>();r.put("handler",name);r.put("inputs",positioned(call(handler,"getIngredientStacks",i)));r.put("outputs",positioned(call(handler,"getResultStack",i)));r.put("other",positioned(call(handler,"getOtherStacks",i)));r.put("container",field(c,"containerRecipe"));r.put("time",field(c,"processingTime"));Object tank=field(c,"tank"),ts=field(tank,"tanks");List<Object> fs=new ArrayList<Object>();for(int j=0;j<Array.getLength(ts);j++){Object f=call(Array.get(ts,j),"getFluid");Map<String,Object> v=new LinkedHashMap<String,Object>();v.put("id","fluid:"+call(call(f,"getFluid"),"getName"));v.put("amount",field(f,"amount"));fs.add(v);}r.put("fluids",fs);rows.add(r);}
            } else {
                Object map=call(handler,"getRecipeMap"),frontend=call(map,"getFrontend"),props=call(frontend,"getNEIProperties");
                for(Object recipe:(Iterable<?>)call(call(map,"getBackend"),"getAllRecipes")) {Map<String,Object> r=new LinkedHashMap<String,Object>();r.put("handler",name);r.put("inputs",itemArray(field(recipe,"mInputs"),recipe,false));r.put("outputs",itemArray(field(recipe,"mOutputs"),recipe,true));Object special=field(recipe,"mSpecialItems");if(special!=null && Class.forName("net.minecraft.item.ItemStack").isInstance(special))r.put("special",castingItem(special));
                    Object getter=field(props,"itemInputsGetter");Object display=((java.util.function.Function) getter).apply(recipe);List<Object> inputs=new ArrayList<Object>();for(int j=0;j<Array.getLength(display);j++){Object st=Array.get(display,j);inputs.add(st==null?null:castingItem(st));}r.put("displayInputs",inputs);if(name.equals("Tree Growth Simulator")){List<Object> tools=new ArrayList<Object>();for(int j=0;j<4;j++){Object alt=call(recipe,"getAltRepresentativeInput",j);List<Object> variants=new ArrayList<Object>();if(alt!=null){if(alt.getClass().isArray()){for(int k=0;k<Array.getLength(alt);k++)try{variants.add(castingItem(Array.get(alt,k)));}catch(Throwable ignored){}}else try{variants.add(castingItem(alt));}catch(Throwable ignored){}}tools.add(variants);}r.put("tools",tools);}rows.add(r);}
            }
        }catch(Throwable e){errors.add("Additional layout: "+e+" / "+e.getCause());}
        write("more-layouts.json",rows);List<Object> items=new ArrayList<Object>();for(Object stack:new ArrayList<Object>(stacks.values()))try{items.add(castingItem(stack));}catch(Throwable e){errors.add("Layout item: "+e);}write("more-layout-items.json",items);write("more-layout-errors.json",errors);status("additional layouts complete: "+rows.size());
    }

    private void exportLayouts(File game,Object mc) throws Exception {
        status("capturing screenshot recipe metadata");
        try(InputStream stream=new FileInputStream(new File(game,"planner-export.research.thaum"))) { Object research=call(Class.forName("net.minecraft.nbt.CompressedStreamTools"),"func_74796_a|readCompressed",stream);call(Class.forName("thaumcraft.common.lib.research.ResearchManager"),"loadResearchNBT",research,field(mc,"field_71439_g|thePlayer")); }
        List<Object> rows=new ArrayList<Object>();
        String[] classes={"com.kuba6000.mobsinfo.nei.MobHandler","crazypants.enderio.nei.SagMillRecipeHandler","tonius.neiintegration.mods.railcraft.RecipeHandlerCokeOven","ru.timeconqueror.tcneiadditions.nei.TCNAInfusionRecipeHandler"};
        Object fbo=Class.forName("com.iouter.gtnhdumper.common.utils.FBOHelper").getConstructor(int.class).newInstance(256);
        Object entityRenderer=field(mc,"field_71460_t|entityRenderer");for(Field f:entityRenderer.getClass().getDeclaredFields()){f.setAccessible(true);Object v=f.get(entityRenderer);if(v!=null && v.getClass().getName().equals("net.minecraft.client.renderer.texture.DynamicTexture")){int[] pixels=(int[])call(v,"func_110565_c|getTextureData");Arrays.fill(pixels,0xffffffff);call(v,"func_110564_a|updateDynamicTexture");}}
        File portraits=new File(output,"mobs");portraits.mkdirs();
        for(String name:classes)try {
            if(new File(game,"planner-export.portraits-only").isFile()&&!name.contains("MobHandler"))continue;
            if(new File(game,"planner-export.supplement-only").isFile()&&!name.contains("Infusion")&&!name.contains("MobHandler"))continue;
            Object handler=Class.forName(name).newInstance();
            if(name.contains("CokeOven"))call(handler,"loadAllRecipes");else call(handler,"loadCraftingRecipes",call(handler,"getOverlayIdentifier"),new Object[0]);
            List<?> cached=(List<?>)field(handler,"arecipes");
            for(int i=0;i<cached.size();i++)try {
                Object c=cached.get(i);Map<String,Object> r=new LinkedHashMap<String,Object>();r.put("handler",call(handler,"getRecipeName"));
                r.put("inputs",positioned(call(handler,"getIngredientStacks",i)));r.put("outputs",positioned(call(handler,"getResultStack",i)));r.put("other",positioned(call(handler,"getOtherStacks",i)));
                Map<String,Object> fields=new LinkedHashMap<String,Object>();
                for(Class<?> cl=c.getClass();cl!=null;cl=cl.getSuperclass())for(Field f:cl.getDeclaredFields()) {f.setAccessible(true);Object v=f.get(c);if(v instanceof Number || v instanceof String || v instanceof Boolean)fields.put(f.getName(),v);}
                r.put("fields",fields);
                if(name.contains("CokeOven")) { Object tank=field(c,"fluidOutput");Object v=tank==null?null:call(field(tank,"tank"),"getFluid");if(v!=null){Map<String,Object> fluid=new LinkedHashMap<String,Object>();fluid.put("id","fluid:"+call(call(v,"getFluid"),"getName"));fluid.put("amount",field(v,"amount"));r.put("fluid",fluid);} }
                if(name.contains("SagMill"))r.put("outputChances",field(c,"outputChance"));
                if(name.contains("MobHandler")) {
                    List<Object> drops=new ArrayList<Object>();
                    for(Object ps:(Iterable<?>)field(c,"mOutputs")) {Map<String,Object> drop=new LinkedHashMap<String,Object>();drop.put("stack",castingItem(field(ps,"item")));drop.put("chance",field(ps,"chance"));drop.put("type",String.valueOf(field(ps,"type")));drop.put("tooltip",field(ps,"extraTooltip"));drops.add(drop);}r.put("drops",drops);
                    List<String> spawns=new ArrayList<String>();for(Object info:(Iterable<?>)field(c,"spawnList"))spawns.add(String.valueOf(call(info,"getInfo")));r.put("spawns",spawns);r.put("additionalInformation",field(c,"additionalInformation"));
                    Object mob=field(c,"mob");String filename=(String.valueOf(field(c,"mobname"))+"_"+String.valueOf(field(c,"localizedName"))).replaceAll("[^a-zA-Z0-9_.-]","_")+".png";
                    try {Class<?> gl=Class.forName("com.gtnewhorizons.angelica.glsm.GLStateManager");call(fbo,"begin");call(gl,"glMatrixMode",5889);call(gl,"glPushMatrix");call(gl,"glLoadIdentity");call(gl,"glOrtho",0d,256d,0d,256d,-1000d,1000d);call(gl,"glMatrixMode",5888);call(field(mc,"field_71460_t|entityRenderer"),"func_78483_a|disableLightmap",0d);call(gl,"enableColorMaterial");call(gl,"glColor4f",1f,1f,1f,1f);call(Class.forName("org.lwjgl.opengl.GL11"),"glCullFace",1029);call(Class.forName("net.minecraft.client.renderer.OpenGlHelper"),"func_77475_a|setLightmapTextureCoords",field(Class.forName("net.minecraft.client.renderer.OpenGlHelper"),"field_77476_b|lightmapTexUnit"),240f,240f);
                        float height=((Number)field(mob,"field_70131_O|height")).floatValue(),width=((Number)field(mob,"field_70130_N|width")).floatValue();
                        call(Class.forName("net.minecraft.client.gui.inventory.GuiInventory"),"func_147046_a|drawEntityOnScreen",128,230,(int)(190/Math.max(1,Math.max(height,width))),-20f,0f,mob);
                        call(gl,"glMatrixMode",5889);call(gl,"glPopMatrix");call(gl,"glMatrixMode",5888);call(fbo,"end");javax.imageio.ImageIO.write((java.awt.image.BufferedImage)call(fbo,"saveToImage"),"png",new File(portraits,filename));call(fbo,"restoreTexture");r.put("portrait",filename);
                    }catch(Throwable e){errors.add("Portrait "+filename+": "+e+" / "+e.getCause());try {Class<?> gl=Class.forName("com.gtnewhorizons.angelica.glsm.GLStateManager");call(gl,"glMatrixMode",5889);call(gl,"glPopMatrix");call(gl,"glMatrixMode",5888);call(fbo,"end");}catch(Throwable ignored){}}
                }
                rows.add(r);
            }catch(Throwable e){errors.add(name+" row "+i+": "+e);}
        }catch(Throwable e){errors.add(name+": "+e);}
        if(new File(game,"planner-export.portraits-only").isFile()){write("portrait-recipes.json",rows);write("portrait-errors.json",errors);status("portrait capture complete");return;}
        if(new File(game,"planner-export.supplement-only").isFile()){
            Object map=field(Class.forName("gregtech.api.recipe.RecipeMaps"),"assemblylineVisualRecipes");for(Object recipe:(Iterable<?>)call(call(map,"getBackend"),"getAllRecipes")){Map<String,Object> r=new LinkedHashMap<String,Object>();r.put("handler","Assemblyline Process");r.put("inputs",itemArray(field(recipe,"mInputs"),recipe,false));r.put("outputs",itemArray(field(recipe,"mOutputs"),recipe,true));Object special=field(recipe,"mSpecialItems");if(special!=null && Class.forName("net.minecraft.item.ItemStack").isInstance(special))r.put("research",castingItem(special));rows.add(r);}
            write("layout-supplement.json",rows);write("layout-supplement-errors.json",errors);status("layout supplement complete");return;
        }
        write("layout-recipes.json",rows);write("layout-errors.json",errors);
        status("rendering layout item icons");List<Object> items=new ArrayList<Object>();for(Object stack:new ArrayList<Object>(stacks.values()))items.add(castingItem(stack));write("layout-items.json",items);
        Object renderer=call(Class.forName("net.minecraft.client.renderer.entity.RenderItem"),"getInstance");File icons=new File(output,"layout-icons");icons.mkdirs();Map<String,String> rendered=new LinkedHashMap<String,String>();
        for(Map.Entry<String,Object> entry:stacks.entrySet())try {Class<?> dumper=Class.forName("com.iouter.gtnhdumper.common.dumper.ItemIconDumper");String filename=(String)call(dumper,"getIconFileName",entry.getValue());javax.imageio.ImageIO.write((java.awt.image.BufferedImage)call(dumper,"renderItem",entry.getValue(),fbo,renderer,1f,null),"png",new File(icons,filename));call(fbo,"restoreTexture");rendered.put(entry.getKey(),filename);}catch(Throwable e){errors.add("Item "+entry.getKey()+": "+e);}
        write("layout-icons.json",rendered);write("layout-errors.json",errors);status("layout metadata capture complete: "+rows.size());
    }

    private Map<String,Object> castingItem(Object stack) throws Exception {
        if(stack==null)return null;
        Map<String,Object> row=new LinkedHashMap<String,Object>();
        Object registry=field(Class.forName("net.minecraft.item.Item"),"field_150901_e|itemRegistry");
        row.put("registryId",call(registry,"func_148750_c|getNameForObject",call(stack,"func_77973_b|getItem")));
        row.put("metadata",call(stack,"func_77960_j|getItemDamage"));
        row.put("amount",field(stack,"field_77994_a|stackSize"));
        Object nbt=call(stack,"func_77978_p|getTagCompound");
        row.put("nbt",nbt==null?"":nbt.toString());
        row.put("id",addStack(stack));
        row.put("name",call(stack,"func_82833_r|getDisplayName"));
        row.put("tooltip",call(Class.forName("com.iouter.gtnhdumper.common.utils.Utils"),"getTooltip",stack));
        return row;
    }
    private String addStack(Object stack) throws Exception {
        if(stack==null)return null;
        String key=String.valueOf(call(Class.forName("com.iouter.gtnhdumper.common.utils.Utils"),"getItemStackShortKey",stack));
        if(!stacks.containsKey(key))stacks.put(key,stack);return key;
    }
    private Map<String,Object> item(Object stack) throws Exception {
        if(stack==null)return null;
        Map<String,Object> value=new LinkedHashMap<String,Object>();value.put("id",addStack(stack));
        value.put("amount",field(stack,"field_77994_a|stackSize"));return value;
    }
    private List<Object> itemArray(Object array, Object recipe, boolean outputSide) throws Exception {
        List<Object> values=new ArrayList<Object>();if(array==null)return values;
        for(int i=0;i<Array.getLength(array);i++){ Object stack=Array.get(array,i);if(stack==null)continue;
            Map<String,Object> value=item(stack); value.put("slot",i);
            if(outputSide)value.put("chance",call(recipe,"getOutputChance",i));values.add(value);
        }return values;
    }
    private List<Object> fluids(Object array) throws Exception {
        List<Object> values=new ArrayList<Object>();if(array==null)return values;
        for(int i=0;i<Array.getLength(array);i++) {Object fluidStack=Array.get(array,i);if(fluidStack==null)continue;
            Object fluid=call(fluidStack,"getFluid");Map<String,Object> value=new LinkedHashMap<String,Object>();
            value.put("id","fluid:"+call(fluid,"getName"));value.put("name",call(fluid,"getLocalizedName",fluidStack));value.put("amount",field(fluidStack,"amount"));value.put("slot",i);values.add(value);
        }return values;
    }
    private List<Object> positioned(Object raw) throws Exception {
        List<Object> result=new ArrayList<Object>(); if(raw==null)return result;
        Iterable<?> list=raw instanceof Iterable ? (Iterable<?>)raw : Collections.singletonList(raw);
        for(Object positioned:list){if(positioned==null)continue;Map<String,Object> value=item(field(positioned,"item")); if(value==null)continue;
            value.put("x",field(positioned,"relx"));value.put("y",field(positioned,"rely"));List<Object> alternatives=new ArrayList<Object>();
            Object a=field(positioned,"items");for(int j=0;j<Array.getLength(a);j++) alternatives.add(item(Array.get(a,j)));value.put("alternatives",alternatives);result.add(value);
        }return result;
    }
    private void dumpRecipes() throws Exception {
        List<Object> handlers=new ArrayList<Object>();Class<?> gt=Class.forName("gregtech.nei.GTNEIDefaultHandler");
        for(Object handler:(Iterable<?>)field(Class.forName("codechicken.nei.recipe.GuiUsageRecipe"),"usagehandlers")) {
            String source=String.valueOf(call(handler,"getHandlerId")).toLowerCase(Locale.ROOT);
            if(thaumOnly && !(source.contains("thaum") || source.contains("tcnei") || source.contains("witchinggadgets") || source.contains("gadomancy") || source.contains("automagy")))continue;
            String name=String.valueOf(call(handler,"getRecipeName"));Map<String,Object> h=new LinkedHashMap<String,Object>();h.put("name",name);h.put("source",call(handler,"getHandlerId"));
            List<Object> recipes=new ArrayList<Object>();h.put("recipes",recipes);handlers.add(h);
            try {
                h.put("overlay",call(handler,"getOverlayIdentifier"));
                if(gt.isInstance(handler)) {
                    h.put("kind","gregtech");Object map=call(handler,"getRecipeMap"),backend=call(map,"getBackend");Object category=field(handler,"recipeCategory");
                    h.put("amperage",field(call(call(map,"getFrontend"),"getUIProperties"),"amperage"));
                    Object ui=call(call(map,"getFrontend"),"getUIProperties");Map<String,Object> slotCounts=new LinkedHashMap<String,Object>();
                    String[] slotKeys={"itemInputs","itemOutputs","fluidInputs","fluidOutputs"};String[] slotFields={"maxItemInputs","maxItemOutputs","maxFluidInputs","maxFluidOutputs"};
                    for(int s=0;s<slotKeys.length;s++)slotCounts.put(slotKeys[s],field(ui,slotFields[s]));h.put("slotCounts",slotCounts);
                    for(Object recipe:(Iterable<?>)call(backend,"getAllRecipes")) {
                        if(call(recipe,"getRecipeCategory")!=category)continue;
                        Map<String,Object> r=new LinkedHashMap<String,Object>();r.put("hidden",field(recipe,"mHidden"));r.put("enabled",field(recipe,"mEnabled"));
                        r.put("durationTicks",field(recipe,"mDuration"));r.put("euPerTick",field(recipe,"mEUt"));r.put("specialValue",field(recipe,"mSpecialValue"));
                        r.put("inputs",itemArray(field(recipe,"mInputs"),recipe,false));r.put("outputs",itemArray(field(recipe,"mOutputs"),recipe,true));
                        r.put("fluidInputs",fluids(field(recipe,"mFluidInputs")));r.put("fluidOutputs",fluids(field(recipe,"mFluidOutputs")));recipes.add(r);
                    }
                } else {
                    h.put("kind","nei");Object overlay=h.get("overlay");
                    if(thaumOnly && source.endsWith("aspectcombinationhandler")) { h.put("kind","aspect-registry");continue; }
                    if(overlay==null)throw new IllegalStateException("No general recipe enumeration interface");
                    if(thaumOnly)((List<?>)field(handler,"arecipes")).clear();
                    call(handler,"loadCraftingRecipes",overlay,new Object[0]);
                    int count=((Number)call(handler,"numRecipes")).intValue();
                    for(int i=0;i<count;i++){Map<String,Object> r=new LinkedHashMap<String,Object>();r.put("inputs",positioned(call(handler,"getIngredientStacks",i)));r.put("outputs",positioned(call(handler,"getResultStack",i)));try{r.put("other",positioned(call(handler,"getOtherStacks",i)));}catch(Throwable error){r.put("otherError",error.toString());}recipes.add(r);}
                }
            } catch(Throwable error){h.put("error",error.toString());errors.add("Handler "+name+": "+error);}
        }
        write("recipes.json",handlers);
    }
    private void status(String message) throws Exception {System.out.println("[PLANNER EXPORT] "+message);Files.write(new File(output,"status.txt").toPath(),(new Date()+" "+message).getBytes(StandardCharsets.UTF_8));}
    private void write(String name,Object value) throws Exception {if(output==null)return;Object gson=Class.forName("com.google.gson.Gson").newInstance();try(Writer writer=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(new File(output,name)),StandardCharsets.UTF_8))){call(gson,"toJson",value,writer);}}
    private static Object field(Object target,String aliases) throws Exception {
        Class<?> type=target instanceof Class ? (Class<?>)target : target.getClass();
        for(Class<?> c=type;c!=null;c=c.getSuperclass())for(String name:aliases.split("\\|")){try{Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(target instanceof Class ? null:target);}catch(NoSuchFieldException ignored){}}
        throw new NoSuchFieldException(type+"."+aliases);
    }
    private static Object construct(String name,Object argument) throws Exception {for(Constructor<?> c:Class.forName(name).getConstructors())if(c.getParameterTypes().length==1 && c.getParameterTypes()[0].isInstance(argument))return c.newInstance(argument);throw new NoSuchMethodException(name);}
    private static Object call(Object target,String aliases,Object...arguments) throws Exception {
        Class<?> type=target instanceof Class ? (Class<?>)target:target.getClass();
        for(String name:aliases.split("\\|"))for(Method m:type.getMethods()) {
            if(!m.getName().equals(name)||m.getParameterTypes().length!=arguments.length)continue;
            try{m.setAccessible(true);return m.invoke(target instanceof Class ? null:target,arguments);}catch(IllegalArgumentException ignored){}catch(InvocationTargetException e){throw new RuntimeException(type.getName()+"."+name,e.getCause());}
        }throw new NoSuchMethodException(type.getName()+"."+aliases);
    }
}
